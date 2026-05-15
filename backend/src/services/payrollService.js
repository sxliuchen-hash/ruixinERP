/**
 * ============================================================
 * 工资条服务（PayrollService）
 * ============================================================
 *
 * 【核心功能】
 *   1) generate    - 生成指定月份全员工资条（草稿）
 *   2) recalculate - 重新计算单人工资条
 *   3) confirm     - 确认锁定
 *   4) list        - 查询列表
 *
 * 【计算逻辑】
 *   收入 = 基本工资 + 岗位补贴 + 全勤奖 + 职级津贴 + 提成 + 奖金
 *   扣除 = 社保 + 请假扣款 + 其他扣款
 *   实发 = 收入 - 扣除
 *
 * 【全勤规则】有请假 → 全勤奖为 0
 * 【请假扣款】日薪 = (基本工资+岗位补贴) ÷ 21.75 × 请假天数
 * 【社保】基数 × 个人缴纳比例合计
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const performanceService = require('./performanceService');
const salaryRuleService = require('./salaryRuleService');

// 职级津贴映射（默认值，实际从 salary_rules 读取）
const DEFAULT_GRADE_ALLOWANCE = { A: 0, B: 200, C: 500, D: 900, E: 1400 };

class PayrollService {

  /**
   * 生成指定月份全员工资条
   * @param {number} year
   * @param {number} month
   * @returns {Promise<{created: number, skipped: number, errors: Array}>}
   */
  async generate(year, month) {
    // 获取在职员工
    const employees = await Employee.findAll({
      where: { status: { [Op.ne]: 'resigned' } }
    });

    // 获取薪资规则
    const gradeRule = await salaryRuleService.getGradeRule();
    const socialRule = await salaryRuleService.getSocialInsuranceRule();
    const generalRule = await salaryRuleService.getRule('general');
    const generalData = generalRule ? generalRule.rule_data : { work_days_per_month: 21.75 };
    const workDays = generalData.work_days_per_month || 21.75;

    // 构建职级津贴映射
    const gradeAllowanceMap = {};
    if (gradeRule && gradeRule.grades) {
      gradeRule.grades.forEach(g => { gradeAllowanceMap[g.grade] = g.allowance; });
    } else {
      Object.assign(gradeAllowanceMap, DEFAULT_GRADE_ALLOWANCE);
    }

    // 获取每人当月业绩
    const ranking = await performanceService.getMonthlyRanking({ year, month, scope: 'all' });
    const profitMap = {};
    ranking.forEach(r => {
      profitMap[r.user_id] = { gross_profit: r.gross_profit, contract_count: r.contract_count, commission: r.commission };
    });

    let created = 0, skipped = 0;
    const errors = [];

    for (const emp of employees) {
      try {
        // 检查是否已存在
        const existing = await Payroll.findOne({
          where: { employee_id: emp.id, year, month }
        });
        if (existing) {
          skipped++;
          continue;
        }

        const payroll = await this._calculatePayroll(emp, year, month, {
          gradeAllowanceMap, socialRule, workDays, profitMap
        });

        await Payroll.create(payroll);
        created++;
      } catch (e) {
        errors.push({ employee_id: emp.id, name: emp.name, error: e.message });
      }
    }

    return { created, skipped, errors };
  }

  /**
   * 计算单人工资条数据
   */
  async _calculatePayroll(emp, year, month, { gradeAllowanceMap, socialRule, workDays, profitMap }) {
    const baseSalary = parseFloat(emp.base_salary) || 0;
    const positionAllowance = parseFloat(emp.position_allowance) || 0;
    const attendanceBonus = parseFloat(emp.attendance_bonus) || 0;

    // 职级津贴（仅销售）
    let gradeAllowance = 0;
    if (emp.role === 'sales') {
      gradeAllowance = gradeAllowanceMap[emp.grade] || 0;
    }

    // 业务提成
    let commission = 0;
    let monthlyProfit = 0;
    let contractCount = 0;

    if (emp.user_id && profitMap[emp.user_id]) {
      const perf = profitMap[emp.user_id];
      monthlyProfit = perf.gross_profit || 0;
      contractCount = perf.contract_count || 0;

      if (emp.role === 'sales') {
        commission = perf.commission || performanceService.calculateCommission(monthlyProfit);
      } else if (emp.role === 'partner') {
        // 合伙人：毛利 × 分成比例（作为提成展示）
        const shareRate = parseFloat(emp.partner_share_rate) || 0.7;
        commission = parseFloat((monthlyProfit * shareRate).toFixed(2));
      }
      // 采购提成后续 T-COST3 实现，暂时为 0
    }

    // 社保扣除
    const socialBase = socialRule ? socialRule.base : 2120;
    const socialRate = socialRule ? socialRule.total_rate : 0.153;
    const socialInsurance = parseFloat((socialBase * socialRate).toFixed(2));

    // 全勤奖（默认有，请假时由 admin 手动设置 leave_days）
    // 生成时默认全勤，admin 后续编辑请假天数
    const finalAttendance = attendanceBonus;

    // 请假扣款（生成时默认 0，admin 后续编辑）
    const leaveDays = 0;
    const dailySalary = (baseSalary + positionAllowance) / workDays;
    const leaveDeduction = parseFloat((leaveDays * dailySalary).toFixed(2));

    // 汇总
    const grossIncome = baseSalary + positionAllowance + finalAttendance + gradeAllowance + commission;
    const totalDeduction = socialInsurance + leaveDeduction;
    const netSalary = parseFloat((grossIncome - totalDeduction).toFixed(2));

    return {
      employee_id: emp.id,
      year,
      month,
      base_salary: baseSalary,
      position_allowance: positionAllowance,
      attendance_bonus: finalAttendance,
      grade_allowance: gradeAllowance,
      commission,
      bonus: 0,
      social_insurance: socialInsurance,
      leave_days: leaveDays,
      leave_deduction: leaveDeduction,
      other_deduction: 0,
      gross_income: parseFloat(grossIncome.toFixed(2)),
      total_deduction: parseFloat(totalDeduction.toFixed(2)),
      net_salary: netSalary,
      monthly_profit: monthlyProfit,
      contract_count: contractCount,
      status: 'draft'
    };
  }

  /**
   * 重新计算单条工资条（仅 draft 状态可重算）
   */
  async recalculate(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认的工资条不可重算');

    const emp = await Employee.findByPk(payroll.employee_id);
    if (!emp) throw new Error('员工不存在');

    const gradeRule = await salaryRuleService.getGradeRule();
    const socialRule = await salaryRuleService.getSocialInsuranceRule();
    const generalRule = await salaryRuleService.getRule('general');
    const generalData = generalRule ? generalRule.rule_data : { work_days_per_month: 21.75 };
    const workDays = generalData.work_days_per_month || 21.75;

    const gradeAllowanceMap = {};
    if (gradeRule && gradeRule.grades) {
      gradeRule.grades.forEach(g => { gradeAllowanceMap[g.grade] = g.allowance; });
    } else {
      Object.assign(gradeAllowanceMap, DEFAULT_GRADE_ALLOWANCE);
    }

    const ranking = await performanceService.getMonthlyRanking({
      year: payroll.year, month: payroll.month, scope: 'all'
    });
    const profitMap = {};
    ranking.forEach(r => { profitMap[r.user_id] = { gross_profit: r.gross_profit, contract_count: r.contract_count, commission: r.commission }; });

    const newData = await this._calculatePayroll(emp, payroll.year, payroll.month, {
      gradeAllowanceMap, socialRule, workDays, profitMap
    });

    // 保留手动填写的字段
    newData.bonus = parseFloat(payroll.bonus) || 0;
    newData.leave_days = parseFloat(payroll.leave_days) || 0;
    newData.other_deduction = parseFloat(payroll.other_deduction) || 0;

    // 重算全勤和请假
    if (newData.leave_days > 0) {
      newData.attendance_bonus = 0;
    }
    const dailySalary = (newData.base_salary + newData.position_allowance) / workDays;
    newData.leave_deduction = parseFloat((newData.leave_days * dailySalary).toFixed(2));

    // 重算汇总
    newData.gross_income = parseFloat((
      newData.base_salary + newData.position_allowance + newData.attendance_bonus +
      newData.grade_allowance + newData.commission + newData.bonus
    ).toFixed(2));
    newData.total_deduction = parseFloat((
      newData.social_insurance + newData.leave_deduction + newData.other_deduction
    ).toFixed(2));
    newData.net_salary = parseFloat((newData.gross_income - newData.total_deduction).toFixed(2));

    await payroll.update(newData);
    return payroll;
  }

  /**
   * 更新工资条（手动编辑字段：奖金、请假天数、其他扣款、备注）
   */
  async update(id, data) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认的工资条不可编辑');

    const generalRule = await salaryRuleService.getRule('general');
    const generalData = generalRule ? generalRule.rule_data : { work_days_per_month: 21.75 };
    const workDays = generalData.work_days_per_month || 21.75;

    // 更新手动字段
    const updates = {};
    if (data.bonus !== undefined) updates.bonus = parseFloat(data.bonus) || 0;
    if (data.leave_days !== undefined) updates.leave_days = parseFloat(data.leave_days) || 0;
    if (data.other_deduction !== undefined) updates.other_deduction = parseFloat(data.other_deduction) || 0;
    if (data.remark !== undefined) updates.remark = data.remark;

    // 重算关联字段
    const leaveDays = updates.leave_days !== undefined ? updates.leave_days : parseFloat(payroll.leave_days);
    const baseSalary = parseFloat(payroll.base_salary);
    const positionAllowance = parseFloat(payroll.position_allowance);
    const originalAttendance = parseFloat(payroll.attendance_bonus);

    // 全勤规则：有请假就没全勤
    if (leaveDays > 0) {
      updates.attendance_bonus = 0;
    } else if (originalAttendance === 0 && leaveDays === 0) {
      // 恢复全勤（从员工档案读取）
      const emp = await Employee.findByPk(payroll.employee_id);
      updates.attendance_bonus = parseFloat(emp?.attendance_bonus) || 100;
    }

    // 请假扣款
    const dailySalary = (baseSalary + positionAllowance) / workDays;
    updates.leave_deduction = parseFloat((leaveDays * dailySalary).toFixed(2));

    // 重算汇总
    const attendanceBonus = updates.attendance_bonus !== undefined ? updates.attendance_bonus : parseFloat(payroll.attendance_bonus);
    const bonus = updates.bonus !== undefined ? updates.bonus : parseFloat(payroll.bonus);
    const otherDeduction = updates.other_deduction !== undefined ? updates.other_deduction : parseFloat(payroll.other_deduction);

    updates.gross_income = parseFloat((
      baseSalary + positionAllowance + attendanceBonus +
      parseFloat(payroll.grade_allowance) + parseFloat(payroll.commission) + bonus
    ).toFixed(2));
    updates.total_deduction = parseFloat((
      parseFloat(payroll.social_insurance) + updates.leave_deduction + otherDeduction
    ).toFixed(2));
    updates.net_salary = parseFloat((updates.gross_income - updates.total_deduction).toFixed(2));

    await payroll.update(updates);
    return payroll.reload();
  }

  /**
   * 确认工资条
   */
  async confirm(id, userId) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('当前状态不可确认');

    await payroll.update({
      status: 'confirmed',
      confirmed_by: userId,
      confirmed_at: new Date()
    });
    return payroll;
  }

  /**
   * 批量确认
   */
  async confirmBatch(year, month, userId) {
    const [count] = await Payroll.update(
      { status: 'confirmed', confirmed_by: userId, confirmed_at: new Date() },
      { where: { year, month, status: 'draft' } }
    );
    return { confirmed: count };
  }

  /**
   * 标记已发放
   */
  async markPaid(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'confirmed') throw new Error('请先确认工资条');
    await payroll.update({ status: 'paid' });
    return payroll;
  }

  /**
   * 查询工资条列表
   */
  async list(query) {
    const { year, month, status, employee_id } = query;
    const where = {};
    if (year) where.year = year;
    if (month) where.month = month;
    if (status) where.status = status;
    if (employee_id) where.employee_id = employee_id;

    const payrolls = await Payroll.findAll({
      where,
      order: [['year', 'DESC'], ['month', 'DESC'], ['net_salary', 'DESC']]
    });

    // 关联员工姓名
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

  /**
   * 获取月度汇总
   */
  async getMonthlySummary(year, month) {
    const payrolls = await this.list({ year, month });
    const summary = {
      total_count: payrolls.length,
      draft_count: 0,
      confirmed_count: 0,
      paid_count: 0,
      total_gross: 0,
      total_deduction: 0,
      total_net: 0
    };

    payrolls.forEach(p => {
      if (p.status === 'draft') summary.draft_count++;
      else if (p.status === 'confirmed') summary.confirmed_count++;
      else if (p.status === 'paid') summary.paid_count++;
      summary.total_gross += parseFloat(p.gross_income) || 0;
      summary.total_deduction += parseFloat(p.total_deduction) || 0;
      summary.total_net += parseFloat(p.net_salary) || 0;
    });

    summary.total_gross = parseFloat(summary.total_gross.toFixed(2));
    summary.total_deduction = parseFloat(summary.total_deduction.toFixed(2));
    summary.total_net = parseFloat(summary.total_net.toFixed(2));

    return { summary, list: payrolls };
  }

  /**
   * 删除工资条（仅 draft）
   */
  async remove(id) {
    const payroll = await Payroll.findByPk(id);
    if (!payroll) throw new Error('工资条不存在');
    if (payroll.status !== 'draft') throw new Error('已确认的工资条不可删除');
    await payroll.destroy();
  }
}

module.exports = new PayrollService();
