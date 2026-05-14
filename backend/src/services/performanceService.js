/**
 * ============================================================
 * 业绩统计服务（PerformanceService）
 * ============================================================
 *
 * 【设计定位】
 * 提供按人按月/按季/按年的销售业绩聚合数据，用于：
 *   - T-HR3 业绩统计看板（排名、趋势）
 *   - T-HR2 职级考核（季度毛利判定）
 *   - T-HR4 工资条（月提成计算）
 *
 * 【业绩归属规则】
 *   业绩归属人 = 合同审批申请人 = contracts.created_by
 *   统计范围：type='sale', status IN ('active','completed'), confirm_status='confirmed'
 *
 * 【公司业务统计范围】
 *   公司业务 = 除刘晨(boss)和罗正武(partner)之外的所有人
 *   刘晨和罗正武单独报表
 *
 * 【提成计算 - 超额累进】
 *   ≤15000: 10%
 *   15001-30000: 15%
 *   30001-50000: 18%
 *   >50000: 22%
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Contract = require('../models/Contract');
const Employee = require('../models/Employee');

/**
 * 提成阶梯配置（超额累进）
 */
const COMMISSION_TIERS = [
  { limit: 15000, rate: 0.10 },
  { limit: 30000, rate: 0.15 },
  { limit: 50000, rate: 0.18 },
  { limit: Infinity, rate: 0.22 }
];

/**
 * 职级津贴配置
 */
const GRADE_ALLOWANCE = {
  A: 0,
  B: 200,
  C: 500,
  D: 900,
  E: 1400
};

/**
 * 季度毛利→职级映射（单位：万元）
 */
const GRADE_THRESHOLDS = [
  { grade: 'E', min: 150000 },  // ≥15万
  { grade: 'D', min: 120000 },  // [12,15)万
  { grade: 'C', min: 90000 },   // [9,12)万
  { grade: 'B', min: 60000 },   // [6,9)万
  { grade: 'A', min: 0 }        // <6万
];

class PerformanceService {

  /**
   * 计算超额累进提成
   * @param {number} grossProfit - 月毛利总额
   * @returns {number} 提成金额
   */
  calculateCommission(grossProfit) {
    if (grossProfit <= 0) return 0;

    let commission = 0;
    let prev = 0;

    for (const tier of COMMISSION_TIERS) {
      const taxable = Math.min(grossProfit, tier.limit) - prev;
      if (taxable <= 0) break;
      commission += taxable * tier.rate;
      prev = tier.limit;
      if (grossProfit <= tier.limit) break;
    }

    return parseFloat(commission.toFixed(2));
  }

  /**
   * 根据季度毛利判定职级
   * @param {number} quarterlyProfit - 季度累计毛利
   * @returns {string} 职级 A-E
   */
  determineGrade(quarterlyProfit) {
    for (const t of GRADE_THRESHOLDS) {
      if (quarterlyProfit >= t.min) return t.grade;
    }
    return 'A';
  }

  /**
   * 获取业绩排名（按人按月聚合）
   *
   * @param {Object} query
   * @param {string} query.year - 年份（YYYY）
   * @param {string} query.month - 月份（1-12）
   * @param {string} [query.scope] - 范围：company(默认)/boss/partner/all
   * @returns {Promise<Array>} 排名列表
   */
  async getMonthlyRanking(query) {
    const { year, month, scope = 'company' } = query;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = new Date(year, month, 0); // 当月最后一天
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endMonth.getDate()).padStart(2, '0')}`;

    // 获取员工列表（用于过滤和展示）
    const employees = await Employee.findAll({
      where: { status: { [Op.ne]: 'resigned' } },
      raw: true
    });

    // 构建 scope 过滤条件
    let excludeUserIds = [];
    if (scope === 'company') {
      // 公司业务：排除 boss 和 partner
      const excluded = employees.filter(e => e.role === 'boss' || e.role === 'partner');
      excludeUserIds = excluded.map(e => e.user_id).filter(Boolean);
    } else if (scope === 'boss') {
      // 仅老板
      const bossEmp = employees.find(e => e.role === 'boss');
      if (!bossEmp || !bossEmp.user_id) return [];
      return this._getPersonMonthly(bossEmp, startDate, endDate);
    } else if (scope === 'partner') {
      // 仅合伙人
      const partnerEmp = employees.find(e => e.role === 'partner');
      if (!partnerEmp || !partnerEmp.user_id) return [];
      return this._getPersonMonthly(partnerEmp, startDate, endDate);
    }

    // 按 created_by 聚合销售合同金额
    let whereClause = `
      WHERE c.type = 'sale'
        AND c.status IN ('active', 'completed')
        AND c.confirm_status = 'confirmed'
        AND c.sign_date BETWEEN :startDate AND :endDate
        AND c.created_by IS NOT NULL
    `;

    const replacements = { startDate, endDate };

    if (excludeUserIds.length > 0) {
      whereClause += ` AND c.created_by NOT IN (:excludeUserIds)`;
      replacements.excludeUserIds = excludeUserIds;
    }

    const rows = await sequelize.query(
      `SELECT
         c.created_by AS user_id,
         COALESCE(c.applyer_name, '') AS applyer_name,
         COUNT(*) AS contract_count,
         COALESCE(SUM(c.amount), 0) AS gross_profit
       FROM contracts c
       ${whereClause}
       GROUP BY c.created_by, c.applyer_name
       ORDER BY gross_profit DESC`,
      { replacements, type: QueryTypes.SELECT }
    );

    // 关联员工信息，计算提成
    const employeeMap = {};
    employees.forEach(e => { if (e.user_id) employeeMap[e.user_id] = e; });

    const result = rows.map((row, index) => {
      const emp = employeeMap[row.user_id] || {};
      const grossProfit = parseFloat(row.gross_profit) || 0;
      const commission = this.calculateCommission(grossProfit);

      return {
        rank: index + 1,
        user_id: row.user_id,
        name: emp.name || row.applyer_name || `用户${row.user_id}`,
        role: emp.role || 'sales',
        grade: emp.grade || 'A',
        contract_count: parseInt(row.contract_count),
        gross_profit: grossProfit,
        commission,
        grade_allowance: GRADE_ALLOWANCE[emp.grade] || 0
      };
    });

    // 补充没有业绩的销售人员（显示为0）
    if (scope === 'company') {
      const salesEmployees = employees.filter(e =>
        e.role === 'sales' && e.user_id && !excludeUserIds.includes(e.user_id)
      );
      salesEmployees.forEach(emp => {
        if (!result.find(r => r.user_id === emp.user_id)) {
          result.push({
            rank: result.length + 1,
            user_id: emp.user_id,
            name: emp.name,
            role: emp.role,
            grade: emp.grade || 'A',
            contract_count: 0,
            gross_profit: 0,
            commission: 0,
            grade_allowance: GRADE_ALLOWANCE[emp.grade] || 0
          });
        }
      });
    }

    return result;
  }

  /**
   * 获取单人月度业绩（boss/partner 专用）
   */
  async _getPersonMonthly(emp, startDate, endDate) {
    const rows = await sequelize.query(
      `SELECT
         COUNT(*) AS contract_count,
         COALESCE(SUM(amount), 0) AS gross_profit
       FROM contracts
       WHERE type = 'sale'
         AND status IN ('active', 'completed')
         AND confirm_status = 'confirmed'
         AND sign_date BETWEEN :startDate AND :endDate
         AND created_by = :userId`,
      { replacements: { startDate, endDate, userId: emp.user_id }, type: QueryTypes.SELECT }
    );

    const grossProfit = parseFloat(rows[0]?.gross_profit) || 0;
    const result = {
      user_id: emp.user_id,
      name: emp.name,
      role: emp.role,
      contract_count: parseInt(rows[0]?.contract_count) || 0,
      gross_profit: grossProfit
    };

    // 合伙人：计算 70%/30% 分成
    if (emp.role === 'partner') {
      const shareRate = parseFloat(emp.partner_share_rate) || 0.7;
      result.partner_income = parseFloat((grossProfit * shareRate).toFixed(2));
      result.boss_share = parseFloat((grossProfit * (1 - shareRate)).toFixed(2));
    }

    return [result];
  }

  /**
   * 获取业绩趋势（近N个月，按人按月）
   *
   * @param {Object} query
   * @param {number} [query.months=6] - 回溯月数
   * @param {string} [query.scope=company] - 范围
   * @param {number} [query.user_id] - 指定用户
   * @returns {Promise<Object>} { months: [], series: [{name, data:[]}] }
   */
  async getTrend(query) {
    const { months = 6, scope = 'company', user_id } = query;

    // 生成月份标签
    const monthLabels = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const startDate = monthLabels[0] + '-01';
    const lastMonth = monthLabels[monthLabels.length - 1];
    const lastMonthDate = new Date(parseInt(lastMonth.split('-')[0]), parseInt(lastMonth.split('-')[1]), 0);
    const endDate = `${lastMonth}-${String(lastMonthDate.getDate()).padStart(2, '0')}`;

    // 获取员工
    const employees = await Employee.findAll({
      where: { status: { [Op.ne]: 'resigned' } },
      raw: true
    });

    // 构建过滤
    let userFilter = '';
    const replacements = { startDate, endDate };

    if (user_id) {
      userFilter = ' AND c.created_by = :userId';
      replacements.userId = user_id;
    } else if (scope === 'company') {
      const excluded = employees.filter(e => e.role === 'boss' || e.role === 'partner');
      const excludeIds = excluded.map(e => e.user_id).filter(Boolean);
      if (excludeIds.length > 0) {
        userFilter = ' AND c.created_by NOT IN (:excludeIds)';
        replacements.excludeIds = excludeIds;
      }
    }

    const rows = await sequelize.query(
      `SELECT
         c.created_by AS user_id,
         DATE_FORMAT(c.sign_date, '%Y-%m') AS month,
         COALESCE(SUM(c.amount), 0) AS gross_profit
       FROM contracts c
       WHERE c.type = 'sale'
         AND c.status IN ('active', 'completed')
         AND c.confirm_status = 'confirmed'
         AND c.sign_date BETWEEN :startDate AND :endDate
         AND c.created_by IS NOT NULL
         ${userFilter}
       GROUP BY c.created_by, DATE_FORMAT(c.sign_date, '%Y-%m')
       ORDER BY month ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    // 构建 series
    const employeeMap = {};
    employees.forEach(e => { if (e.user_id) employeeMap[e.user_id] = e; });

    // 按用户分组
    const userDataMap = {};
    rows.forEach(row => {
      if (!userDataMap[row.user_id]) {
        userDataMap[row.user_id] = {};
      }
      userDataMap[row.user_id][row.month] = parseFloat(row.gross_profit) || 0;
    });

    const series = Object.keys(userDataMap).map(uid => {
      const emp = employeeMap[uid];
      return {
        user_id: parseInt(uid),
        name: emp?.name || `用户${uid}`,
        data: monthLabels.map(m => userDataMap[uid][m] || 0)
      };
    });

    // 按总业绩排序
    series.sort((a, b) => {
      const sumA = a.data.reduce((s, v) => s + v, 0);
      const sumB = b.data.reduce((s, v) => s + v, 0);
      return sumB - sumA;
    });

    // 公司汇总线
    const totalData = monthLabels.map((m, i) =>
      series.reduce((sum, s) => sum + s.data[i], 0)
    );

    return {
      months: monthLabels,
      series,
      total: { name: '公司合计', data: totalData }
    };
  }

  /**
   * 获取季度业绩汇总（用于职级考核）
   *
   * @param {Object} query
   * @param {string} query.year
   * @param {number} query.quarter - 1/2/3/4
   * @returns {Promise<Array>}
   */
  async getQuarterlySummary(query) {
    const { year, quarter } = query;
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endMonthDate = new Date(year, endMonth, 0);
    const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(endMonthDate.getDate()).padStart(2, '0')}`;

    const employees = await Employee.findAll({
      where: { status: { [Op.ne]: 'resigned' }, role: 'sales' },
      raw: true
    });

    const rows = await sequelize.query(
      `SELECT
         c.created_by AS user_id,
         COALESCE(SUM(c.amount), 0) AS gross_profit,
         COUNT(*) AS contract_count
       FROM contracts c
       WHERE c.type = 'sale'
         AND c.status IN ('active', 'completed')
         AND c.confirm_status = 'confirmed'
         AND c.sign_date BETWEEN :startDate AND :endDate
         AND c.created_by IS NOT NULL
       GROUP BY c.created_by`,
      { replacements: { startDate, endDate }, type: QueryTypes.SELECT }
    );

    const profitMap = {};
    rows.forEach(r => {
      profitMap[r.user_id] = {
        gross_profit: parseFloat(r.gross_profit) || 0,
        contract_count: parseInt(r.contract_count) || 0
      };
    });

    return employees.map(emp => {
      const data = profitMap[emp.user_id] || { gross_profit: 0, contract_count: 0 };
      const suggestedGrade = this.determineGrade(data.gross_profit);
      return {
        employee_id: emp.id,
        user_id: emp.user_id,
        name: emp.name,
        current_grade: emp.grade,
        suggested_grade: suggestedGrade,
        gross_profit: data.gross_profit,
        contract_count: data.contract_count,
        grade_allowance: GRADE_ALLOWANCE[suggestedGrade]
      };
    }).sort((a, b) => b.gross_profit - a.gross_profit);
  }

  /**
   * 获取业绩概览（看板顶部统计卡片）
   *
   * @param {Object} query { year, month }
   * @returns {Promise<Object>}
   */
  async getOverview(query) {
    const { year, month } = query;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonthDate = new Date(year, month, 0);
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endMonthDate.getDate()).padStart(2, '0')}`;

    // 上月同期
    const prevMonth = month == 1 ? 12 : month - 1;
    const prevYear = month == 1 ? year - 1 : year;
    const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevEndMonthDate = new Date(prevYear, prevMonth, 0);
    const prevEndDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevEndMonthDate.getDate()).padStart(2, '0')}`;

    // 获取排除的用户
    const excluded = await Employee.findAll({
      where: { role: { [Op.in]: ['boss', 'partner'] } },
      attributes: ['user_id'],
      raw: true
    });
    const excludeIds = excluded.map(e => e.user_id).filter(Boolean);

    let excludeClause = '';
    const replacements = { startDate, endDate, prevStartDate, prevEndDate };
    if (excludeIds.length > 0) {
      excludeClause = ' AND created_by NOT IN (:excludeIds)';
      replacements.excludeIds = excludeIds;
    }

    // 本月公司业绩
    const [current] = await sequelize.query(
      `SELECT
         COUNT(*) AS contract_count,
         COALESCE(SUM(amount), 0) AS gross_profit
       FROM contracts
       WHERE type = 'sale'
         AND status IN ('active', 'completed')
         AND confirm_status = 'confirmed'
         AND sign_date BETWEEN :startDate AND :endDate
         AND created_by IS NOT NULL
         ${excludeClause}`,
      { replacements, type: QueryTypes.SELECT }
    );

    // 上月公司业绩
    const [previous] = await sequelize.query(
      `SELECT
         COUNT(*) AS contract_count,
         COALESCE(SUM(amount), 0) AS gross_profit
       FROM contracts
       WHERE type = 'sale'
         AND status IN ('active', 'completed')
         AND confirm_status = 'confirmed'
         AND sign_date BETWEEN :prevStartDate AND :prevEndDate
         AND created_by IS NOT NULL
         ${excludeClause}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const currentProfit = parseFloat(current?.gross_profit) || 0;
    const previousProfit = parseFloat(previous?.gross_profit) || 0;
    const growthRate = previousProfit > 0
      ? parseFloat(((currentProfit - previousProfit) / previousProfit * 100).toFixed(1))
      : (currentProfit > 0 ? 100 : 0);

    return {
      current_month: {
        gross_profit: currentProfit,
        contract_count: parseInt(current?.contract_count) || 0
      },
      previous_month: {
        gross_profit: previousProfit,
        contract_count: parseInt(previous?.contract_count) || 0
      },
      growth_rate: growthRate
    };
  }
}

module.exports = new PerformanceService();
