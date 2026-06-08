/**
 * ============================================================
 * 工资条服务（PayrollService）
 * ============================================================
 *
 * 【核心功能】
 *   1) generate    - 生成指定月份全员工资条（草稿）
 *   2) recalculate - 重新计算单人工资条
 *   3) update      - 手动编辑（考勤天数/奖金/其他扣款）
 *   4) confirm     - 确认锁定
 *   5) void        - 作废（confirmed/paid 可作废）
 *   6) addAdjustment - 新增调整项工资条（补发/补扣）
 *   7) list / summary
 *
 * 【收入项】
 *   基本工资 + 岗位补贴 + 全勤奖 + 职级津贴 + 销售提成 + 采购提成 + 奖金
 *
 * 【扣除项】
 *   社保 + 个税 + 事假扣款 + 病假扣款 + 其他扣款
 *
 * 【提成数据源】（与业务方确认后调整）
 *   销售提成：来自每月上传的业绩统计表（performance_records 按员工+归属月汇总核定业绩，
 *             再套 salary_rules.commission 超额累进阶梯）。
 *             提成在"业绩归属月 + 1"工资条发放（回款次月发）。
 *   采购提成：purchaseCommissionService 按卖出时间衰减档计算（仅采购人员卖出自营专利）。
 *
 * 【考勤】
 *   全勤奖：当月无任何请假即发；有事假/病假即清零
 *   事假扣款：日薪 × 事假天数（日薪 = (基本工资+岗位补贴) ÷ 21.75）
 *   病假扣款：日薪 × (1 − 病假发放系数) × 病假天数
 *
 * 【个税】简化版按月独立计税（salary_rules.income_tax）
 * 【实发下限】不低于 最低工资 × 比例（salary_rules.attendance）
 * 【合伙人/老板】不生成工资条（generate 跳过 boss/partner）
 * ============================================================
 */

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const salaryRuleService = require('./salaryRuleService');
const performanceUploadService = require('./performanceUploadService');
const purchaseCommissionService = require('./purchaseCommissionService');

// 职级津贴默认映射（实际从 salary_rules 读取）
const DEFAULT_GRADE_ALLOWANCE = { A: 0, B: 200, C: 500, D: 900, E: 1400 };

class PayrollService {

  /**
   * 加载本月计算所需的全部规则（一次性，供批量生成复用）
   */
  async _loadRules() {
    const gradeRule = await salaryRuleService.getGradeRule();
    const socialRule = await salaryRuleService.getSocialInsuranceRule();
    const commissionRule = await salaryRuleService.getCommissionRule();
    const attendanceRule = await salaryRuleService.getAttendanceRule();
    const incomeTaxRule = await salaryRuleService.getIncomeTaxRule();

    const gradeAllowanceMap = {};
    if (gradeRule && gradeRule.grades) {
      gradeRule.grades.forEach(g => { gradeAllowanceMap[g.grade] = g.allowance; });
    } else {
      Object.assign(gradeAllowanceMap, DEFAULT_GRADE_ALLOWANCE);
    }

    const workDays = (attendanceRule && attendanceRule.work_days_per_month) || 21.75;

    return { gradeAllowanceMap, socialRule, commissionRule, attendanceRule, incomeTaxRule, workDays };
  }

  /**
   * 按超额累进阶梯计算销售提成
   * @param {number} amount 月核定业绩合计
   * @param {Object} commissionRule salary_rules.commission rule_data
   */
  calcSalesCommission(amount, commissionRule) {
    if (!amount || amount <= 0) return 0;
    const tiers = (commissionRule && commissionRule.tiers) || [];
    if (tiers.length === 0) return 0;

    let commission = 0;
    for (const tier of tiers) {
      const min = tier.min ?? 0;
      const max = tier.max == null ? Infinity : tier.max;
      if (amount > min) {
        const taxable = Math.min(amount, max) - min;
        if (taxable > 0) commission += taxable * tier.rate;
      }
    }
    return parseFloat(commission.toFixed(2));
  }

  /**
   * 个税（简化版按月独立计税）
   * @param {number} taxableBase 应发 − 个人社保
   * @param {Object} incomeTaxRule
   */
  calcIncomeTax(taxableBase, incomeTaxRule) {
    if (!incomeTaxRule) return 0;
    const threshold = incomeTaxRule.threshold || 5000;
    const special = incomeTaxRule.special_deduction || 0;
    const taxable = taxableBase - threshold - special;
    if (taxable <= 0) return 0;
    const brackets = incomeTaxRule.brackets || [];
    for (const b of brackets) {
      const min = b.min ?? 0;
      const max = b.max == null ? Infinity : b.max;
      if (taxable > min && taxable <= max) {
        return parseFloat((taxable * b.rate - (b.deduct || 0)).toFixed(2));
      }
    }
    return 0;
  }

  /**
   * 生成指定月份全员工资条（草稿）
   * 跳过 boss / partner（不生成工资条，单独报表）
   */
  async generate(year, month) {
    const employees = await Employee.findAll({
      where: {
        status: { [Op.ne]: 'resigned' },
        role: { [Op.notIn]: ['boss', 'partner'] }
      }
    });

    const rules = await this._loadRules();

    let created = 0, skipped = 0;
    const errors = [];

    for (const emp of employees) {
      try {
        // 已存在主工资条（非调整项）则跳过
        const existing = await Payroll.findOne({
          where: { employee_id: emp.id, year, month, is_adjustment: false }
        });
        if (existing) { skipped++; continue; }

        const data = await this._calculatePayroll(emp, year, month, rules);
        await Payroll.create(data);
        created++;
      } catch (e) {
        errors.push({ employee_id: emp.id, name: emp.name, error: e.message });
      }
    }

    return { created, skipped, errors };
  }

  /**
   * 计算单人工资条数据（默认无请假，全勤）
   */
  async _calculatePayroll(emp, year, month, rules) {
    const { gradeAllowanceMap, socialRule, commissionRule, attendanceRule, incomeTaxRule, workDays } = rules;

    const baseSalary = parseFloat(emp.base_salary) || 0;
    const positionAllowance = parseFloat(emp.position_allowance) || 0;
    const attendanceBonus = parseFloat(emp.attendance_bonus) || 0;

    // 职级津贴（仅销售）
    let gradeAllowance = 0;
    if (emp.role === 'sales') {
      gradeAllowance = gradeAllowanceMap[emp.grade] || 0;
    }

    // 销售提成：来自上传的业绩统计表（按员工 + 归属月）
    let commission = 0;
    let monthlyProfit = 0;
    if (emp.role === 'sales') {
      const perf = await performanceUploadService.getMonthlyPerformance(emp.id, year, month);
      monthlyProfit = perf.total;
      commission = this.calcSalesCommission(perf.total, commissionRule);
    }

    // 采购提成：采购人员卖出自营专利（按卖出时间衰减档）
    let purchaseCommission = 0;
    if (emp.role === 'purchase') {
      const pc = await purchaseCommissionService.getMonthlyCommission(emp.id, year, month);
      purchaseCommission = pc.total;
    }

    // 社保扣除
    const socialBase = (emp.social_insurance_base && parseFloat(emp.social_insurance_base))
      || (socialRule ? socialRule.base : 2120);
    const socialRate = (emp.social_insurance_rate && parseFloat(emp.social_insurance_rate))
      || (socialRule ? socialRule.total_rate : 0.153);
    const socialInsurance = parseFloat((socialBase * socialRate).toFixed(2));

    // 默认全勤、无请假
    const finalAttendance = attendanceBonus;
    const leaveCalc = this._calcLeave(0, 0, baseSalary, positionAllowance, workDays, attendanceRule);

    // 应发合计
    const grossIncome = baseSalary + positionAllowance + finalAttendance +
      gradeAllowance + commission + purchaseCommission;

    // 个税（应发 − 个人社保 − 起征点）
    const incomeTax = this.calcIncomeTax(grossIncome - socialInsurance, incomeTaxRule);

    const result = this._assemble({
      employee_id: emp.id, year, month,
      base_salary: baseSalary,
      position_allowance: positionAllowance,
      attendance_bonus: finalAttendance,
      grade_allowance: gradeAllowance,
      commission,
      purchase_commission: purchaseCommission,
      bonus: 0,
      social_insurance: socialInsurance,
      income_tax: incomeTax,
      personal_leave_days: 0,
      sick_leave_days: 0,
      leave_deduction: leaveCalc.total,
      other_deduction: 0,
      monthly_profit: monthlyProfit,
      contract_count: 0,
      status: 'draft'
    }, attendanceRule);

    return result;
  }

  /**
   * 计算请假扣款
   * @returns {{personal:number, sick:number, total:number}}
   */
  _calcLeave(personalDays, sickDays, baseSalary, positionAllowance, workDays, attendanceRule) {
    const dailySalary = (baseSalary + positionAllowance) / (workDays || 21.75);
    const personalRate = (attendanceRule && attendanceRule.personal_leave_deduct_rate != null)
      ? attendanceRule.personal_leave_deduct_rate : 1;
    const sickPayRate = (attendanceRule && attendanceRule.sick_pay_rate != null)
      ? attendanceRule.sick_pay_rate : 0.6;

    const personal = parseFloat((dailySalary * personalRate * (personalDays || 0)).toFixed(2));
    const sick = parseFloat((dailySalary * (1 - sickPayRate) * (sickDays || 0)).toFixed(2));
    return { personal, sick, total: parseFloat((personal + sick).toFixed(2)) };
  }

  /**
   * 组装工资条汇总字段（计算 gross/deduction/net + 实发下限兜底）
   */
  _assemble(d, attendanceRule) {
    const grossIncome = (parseFloat(d.base_salary) || 0) +
      (parseFloat(d.position_allowance) || 0) +
      (parseFloat(d.attendance_bonus) || 0) +
      (parseFloat(d.grade_allowance) || 0) +
      (parseFloat(d.commission) || 0) +
      (parseFloat(d.purchase_commission) || 0) +
      (parseFloat(d.bonus) || 0);

    const totalDeduction = (parseFloat(d.social_insurance) || 0) +
      (parseFloat(d.income_tax) || 0) +
      (parseFloat(d.leave_deduction) || 0) +
      (parseFloat(d.other_deduction) || 0);

    let netSalary = grossIncome - totalDeduction;

    // 实发下限兜底（最低工资 × 比例），仅对非调整项生效
    if (!d.is_adjustment && attendanceRule && attendanceRule.min_wage) {
      const floor = attendanceRule.min_wage * (attendanceRule.min_wage_ratio || 0.8);
      if (netSalary < floor && netSalary > 0) {
        netSalary = floor;
      }
    }

    // 合并旧字段 leave_days = 事假 + 病假
    d.leave_days = parseFloat(((parseFloat(d.personal_leave_days) || 0) + (parseFloat(d.sick_leave_days) || 0)).toFixed(1));
    d.gross_income = parseFloat(grossIncome.toFixed(2));
    d.total_deduction = parseFloat(totalDeduction.toFixed(2));
    d.net_salary = parseFloat(netSalary.toFixed(2));
    return d;
  }

  /**
   * 重算单条工资条（draft 才可重算），保留手动字段
   */
  async recalculate(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认/作废的工资条不可重算');
    if (payroll.is_adjustment) throw new Error('调整项工资条不支持重算');

    const emp = await Employee.findByPk(payroll.employee_id);
    if (!emp) throw new Error('员工不存在');

    const rules = await this._loadRules();
    const data = await this._calculatePayroll(emp, payroll.year, payroll.month, rules);

    // 保留手动字段
    const personalDays = parseFloat(payroll.personal_leave_days) || 0;
    const sickDays = parseFloat(payroll.sick_leave_days) || 0;
    data.bonus = parseFloat(payroll.bonus) || 0;
    data.other_deduction = parseFloat(payroll.other_deduction) || 0;
    data.personal_leave_days = personalDays;
    data.sick_leave_days = sickDays;

    // 重算请假和全勤
    const leave = this._calcLeave(personalDays, sickDays, data.base_salary, data.position_allowance, rules.workDays, rules.attendanceRule);
    data.leave_deduction = leave.total;
    if (personalDays > 0 || sickDays > 0) {
      data.attendance_bonus = 0;
    }

    // 重算个税和汇总
    data.income_tax = this.calcIncomeTax(
      (data.base_salary + data.position_allowance + data.attendance_bonus + data.grade_allowance +
        data.commission + data.purchase_commission + data.bonus) - data.social_insurance,
      rules.incomeTaxRule
    );
    this._assemble(data, rules.attendanceRule);

    await payroll.update(data);
    return payroll;
  }

  /**
   * 手动编辑（请假天数/奖金/其他扣款/备注）
   */
  async update(id, body) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认/作废的工资条不可编辑');

    const rules = await this._loadRules();

    const personalDays = body.personal_leave_days !== undefined
      ? parseFloat(body.personal_leave_days) || 0 : parseFloat(payroll.personal_leave_days) || 0;
    const sickDays = body.sick_leave_days !== undefined
      ? parseFloat(body.sick_leave_days) || 0 : parseFloat(payroll.sick_leave_days) || 0;
    const bonus = body.bonus !== undefined ? parseFloat(body.bonus) || 0 : parseFloat(payroll.bonus) || 0;
    const otherDeduction = body.other_deduction !== undefined
      ? parseFloat(body.other_deduction) || 0 : parseFloat(payroll.other_deduction) || 0;

    const baseSalary = parseFloat(payroll.base_salary) || 0;
    const positionAllowance = parseFloat(payroll.position_allowance) || 0;

    // 全勤：有任何请假即清零，否则恢复员工档案全勤
    let attendanceBonus = parseFloat(payroll.attendance_bonus) || 0;
    if (personalDays > 0 || sickDays > 0) {
      attendanceBonus = 0;
    } else {
      const emp = await Employee.findByPk(payroll.employee_id);
      attendanceBonus = parseFloat(emp?.attendance_bonus) || 0;
    }

    const leave = this._calcLeave(personalDays, sickDays, baseSalary, positionAllowance, rules.workDays, rules.attendanceRule);

    const data = {
      base_salary: baseSalary,
      position_allowance: positionAllowance,
      attendance_bonus: attendanceBonus,
      grade_allowance: parseFloat(payroll.grade_allowance) || 0,
      commission: parseFloat(payroll.commission) || 0,
      purchase_commission: parseFloat(payroll.purchase_commission) || 0,
      bonus,
      social_insurance: parseFloat(payroll.social_insurance) || 0,
      personal_leave_days: personalDays,
      sick_leave_days: sickDays,
      leave_deduction: leave.total,
      other_deduction: otherDeduction,
      is_adjustment: payroll.is_adjustment
    };

    // 个税重算
    data.income_tax = this.calcIncomeTax(
      (data.base_salary + data.position_allowance + data.attendance_bonus + data.grade_allowance +
        data.commission + data.purchase_commission + data.bonus) - data.social_insurance,
      rules.incomeTaxRule
    );

    this._assemble(data, rules.attendanceRule);
    if (body.remark !== undefined) data.remark = body.remark;

    await payroll.update(data);
    return payroll.reload();
  }

  /** 确认工资条 */
  async confirm(id, userId) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('当前状态不可确认');
    await payroll.update({ status: 'confirmed', confirmed_by: userId, confirmed_at: new Date() });
    return payroll;
  }

  /** 批量确认 */
  async confirmBatch(year, month, userId) {
    const [count] = await Payroll.update(
      { status: 'confirmed', confirmed_by: userId, confirmed_at: new Date() },
      { where: { year, month, status: 'draft' } }
    );
    return { confirmed: count };
  }

  /** 标记已发放 */
  async markPaid(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'confirmed') throw new Error('请先确认工资条');
    await payroll.update({ status: 'paid' });
    return payroll;
  }

  /**
   * 作废工资条（confirmed / paid 可作废；draft 直接删除即可）
   * @param {number} id
   * @param {string} reason 作废原因
   */
  async voidPayroll(id, reason) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status === 'voided') throw new Error('该工资条已作废');
    if (payroll.status === 'draft') throw new Error('草稿请直接删除，无需作废');
    await payroll.update({ status: 'voided', voided_reason: reason || '' });
    return payroll;
  }

  /**
   * 新增调整项工资条（补发/补扣）
   * 用于已确认/发放后的更正：金额可正可负，单独一条记录。
   * @param {Object} body { employee_id, year, month, bonus, other_deduction, remark, adjust_source_id }
   */
  async addAdjustment(body) {
    const emp = await Employee.findByPk(body.employee_id);
    if (!emp) throw new Error('员工不存在');

    const rules = await this._loadRules();
    const bonus = parseFloat(body.bonus) || 0;          // 补发（正）
    const otherDeduction = parseFloat(body.other_deduction) || 0; // 补扣（正）

    const data = this._assemble({
      employee_id: emp.id,
      year: parseInt(body.year),
      month: parseInt(body.month),
      base_salary: 0, position_allowance: 0, attendance_bonus: 0,
      grade_allowance: 0, commission: 0, purchase_commission: 0,
      bonus,
      social_insurance: 0, income_tax: 0,
      personal_leave_days: 0, sick_leave_days: 0, leave_deduction: 0,
      other_deduction: otherDeduction,
      monthly_profit: 0, contract_count: 0,
      status: 'draft',
      is_adjustment: true,
      adjust_source_id: body.adjust_source_id || null,
      remark: body.remark || '调整项'
    }, rules.attendanceRule);

    return Payroll.create(data);
  }

  /** 查询工资条列表 */
  async list(query) {
    const { year, month, status, employee_id } = query;
    const where = {};
    if (year) where.year = year;
    if (month) where.month = month;
    if (status) where.status = status;
    if (employee_id) where.employee_id = employee_id;

    const payrolls = await Payroll.findAll({
      where,
      order: [['year', 'DESC'], ['month', 'DESC'], ['is_adjustment', 'ASC'], ['net_salary', 'DESC']]
    });

    const empIds = [...new Set(payrolls.map(p => p.employee_id))];
    const employees = await Employee.findAll({ where: { id: empIds }, raw: true });
    const empMap = {};
    employees.forEach(e => { empMap[e.id] = e; });

    return payrolls.map(p => {
      const emp = empMap[p.employee_id] || {};
      return {
        ...p.toJSON(),
        employee_name: emp.name || '',
        employee_role: emp.role || '',
        employee_grade: emp.grade || ''
      };
    });
  }

  /** 月度汇总 */
  async getMonthlySummary(year, month) {
    const payrolls = await this.list({ year, month });
    const summary = {
      total_count: payrolls.length,
      draft_count: 0, confirmed_count: 0, paid_count: 0, voided_count: 0,
      total_gross: 0, total_deduction: 0, total_net: 0
    };

    payrolls.forEach(p => {
      if (p.status === 'draft') summary.draft_count++;
      else if (p.status === 'confirmed') summary.confirmed_count++;
      else if (p.status === 'paid') summary.paid_count++;
      else if (p.status === 'voided') summary.voided_count++;
      if (p.status !== 'voided') {
        summary.total_gross += parseFloat(p.gross_income) || 0;
        summary.total_deduction += parseFloat(p.total_deduction) || 0;
        summary.total_net += parseFloat(p.net_salary) || 0;
      }
    });

    summary.total_gross = parseFloat(summary.total_gross.toFixed(2));
    summary.total_deduction = parseFloat(summary.total_deduction.toFixed(2));
    summary.total_net = parseFloat(summary.total_net.toFixed(2));

    return { summary, list: payrolls };
  }

  /** 删除工资条（仅 draft） */
  async remove(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认/发放/作废的工资条不可删除');
    await payroll.destroy();
  }
}

module.exports = new PayrollService();
