/**
 * ============================================================
 * Dashboard 聚合服务（DashboardService）
 * ============================================================
 *
 * 【设计定位】
 * 提供首页所需的各类聚合数据，将 Payment/Contract/BankAccount 等模型
 * 聚合为适合前端展示的视图模型（VO）。
 *
 * 【六个聚合接口】
 *   1) getOverview        - 核心指标：现金流入/流出/净额、应收/应付、毛利润
 *   2) getAccounts        - 各银行账户实时余额（调用 accountService 复用逻辑）
 *   3) getTrend           - 近 12 个月收支趋势（按月分组）
 *   4) getCostBreakdown   - 成本构成（按 cost_category_id 分组）
 *   5) getPending         - 待确认单据数（payments + contracts）
 *   6) getAging           - 应收账龄分布（5 档）
 *
 * 【性能考虑】
 * - 大量使用 Sequelize 聚合 + 原始 SQL，避免 N+1
 * - 毛利润目前用"现金净额"粗估，Phase 3 接入 projects 表后改为精确计算
 * - 后续可接入 Redis 缓存（TTL 5 分钟），key 前缀 `erp:dashboard:*`
 *
 * 【时间范围约定】
 * period 参数支持 month / quarter / year，均以"当前日期所在"为准：
 *   - month   = 当月 1 日 ~ 当月最后一日
 *   - quarter = 当季度第一天 ~ 当季度最后一天
 *   - year    = 当年 1 月 1 日 ~ 当年 12 月 31 日
 * 若显式传入 start/end，则覆盖 period 逻辑。
 * ============================================================
 */

const { Op, fn, col } = require('sequelize');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const Payment = require('../models/Payment');
const Contract = require('../models/Contract');
const BankAccount = require('../models/BankAccount');
const accountService = require('./accountService');

/**
 * 根据 period 计算 [startDate, endDate]
 * @param {string} period - month | quarter | year
 * @param {string} [start] - 显式起始日期（YYYY-MM-DD），会覆盖 period
 * @param {string} [end]   - 显式截止日期（YYYY-MM-DD），会覆盖 period
 * @returns {{startDate: string, endDate: string}}
 */
function getDateRange(period = 'month', start, end) {
  if (start && end) return { startDate: start, endDate: end };

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  let startDate, endDate;

  if (period === 'year') {
    startDate = new Date(year, 0, 1);
    endDate = new Date(year, 11, 31);
  } else if (period === 'quarter') {
    // 季度起始月：0(Q1)/3(Q2)/6(Q3)/9(Q4)
    const qStart = Math.floor(month / 3) * 3;
    startDate = new Date(year, qStart, 1);
    endDate = new Date(year, qStart + 3, 0); // 下个季度的第 0 天 = 当季度最后一天
  } else {
    // month：当月 1 日 ~ 当月最后一日（用 day=0 的 month+1 技巧）
    startDate = new Date(year, month, 1);
    endDate = new Date(year, month + 1, 0);
  }

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10)
  };
}

class DashboardService {
  /**
   * 核心指标：现金流、应收应付、毛利润
   *
   * 说明：
   * - 现金流仅统计 confirm_status=confirmed 的 payments（pending 的不计入已发生现金流）
   * - 应收 = 销售合同金额总和 - 已收款（paid_amount）总和，只统计 active/completed 合同
   * - 应付类似逻辑
   * - 毛利润 Phase 1 粗估：现金净额。Phase 3 接入 projects 后改为精确利润
   *
   * @param {Object} query {period, start, end}
   * @returns {Promise<Object>} 核心指标对象
   */
  async getOverview(query) {
    const { startDate, endDate } = getDateRange(query.period, query.start, query.end);

    // ===== 现金流入/流出（区间内已确认 payments 按 type 分组聚合）=====
    const paymentStats = await Payment.findAll({
      attributes: [
        'type',
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
        [fn('COUNT', col('id')), 'count']
      ],
      where: {
        payment_date: { [Op.between]: [startDate, endDate] },
        confirm_status: 'confirmed'
      },
      group: ['type'],
      raw: true
    });

    let cashIn = 0, cashOut = 0;
    paymentStats.forEach(s => {
      const t = parseFloat(s.total) || 0;
      if (s.type === 'income') cashIn = t;
      else if (s.type === 'expense') cashOut = t;
    });
    const cashNet = parseFloat((cashIn - cashOut).toFixed(2));

    // ===== 应收：销售合同金额 - 已收款（active/completed 状态）=====
    const saleContracts = await Contract.findAll({
      attributes: [
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total_amount'],
        [fn('COALESCE', fn('SUM', col('paid_amount')), 0), 'total_paid']
      ],
      where: { type: 'sale', status: { [Op.in]: ['active', 'completed'] } },
      raw: true
    });

    // ===== 应付：采购合同金额 - 已付款 =====
    const purchaseContracts = await Contract.findAll({
      attributes: [
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total_amount'],
        [fn('COALESCE', fn('SUM', col('paid_amount')), 0), 'total_paid']
      ],
      where: { type: 'purchase', status: { [Op.in]: ['active', 'completed'] } },
      raw: true
    });

    const receivable = parseFloat(
      (parseFloat(saleContracts[0]?.total_amount || 0) - parseFloat(saleContracts[0]?.total_paid || 0)).toFixed(2)
    );
    const payable = parseFloat(
      (parseFloat(purchaseContracts[0]?.total_amount || 0) - parseFloat(purchaseContracts[0]?.total_paid || 0)).toFixed(2)
    );

    // ===== 毛利润：Phase 3 T16 起改为 projects 精确聚合 =====
    // 取所有项目的 gross_profit 合计（不受 period 过滤，代表当前库存期累计利润）
    // 和 period 内新创建项目的毛利润（可选扩展，当前用全量）
    const projectService = require('./projectService');
    const profitSummary = await projectService.getProfitSummary({});
    const grossProfit = profitSummary.all.gross_profit;
    const completedProfit = profitSummary.completed.gross_profit;

    return {
      period: { start: startDate, end: endDate },
      cash_in: parseFloat(cashIn.toFixed(2)),
      cash_out: parseFloat(cashOut.toFixed(2)),
      cash_net: cashNet,
      receivable,
      payable,
      // T16 起使用 projects 聚合的毛利润（全部项目合计）
      gross_profit: grossProfit,
      // 额外返回"已完成项目"的利润，便于前端区分潜在利润和已兑现利润
      completed_profit: completedProfit,
      project_count: profitSummary.all.count,
      completed_count: profitSummary.completed.count
    };
  }

  /**
   * 各账户实时余额
   *
   * 实现：直接复用 accountService.calculateBalance（已在 T3 实现）
   * 避免 Dashboard 重复实现余额计算逻辑，后续余额规则变化只需改一处。
   *
   * @returns {Promise<{list: Array, total: number}>}
   */
  async getAccounts() {
    const accounts = await BankAccount.findAll({
      where: { status: 1 }, // 仅展示启用的账户
      order: [['create_time', 'ASC']]
    });

    const result = await Promise.all(
      accounts.map(async (a) => {
        const balance = await accountService.calculateBalance(a.id, a.initial_balance);
        return {
          id: a.id,
          name: a.name,
          bank_name: a.bank_name,
          account_type: a.account_type,
          balance
        };
      })
    );

    const total = parseFloat(result.reduce((s, x) => s + (x.balance || 0), 0).toFixed(2));

    return { list: result, total };
  }

  /**
   * 近 12 个月收支趋势
   *
   * 返回固定 12 条数据（月份对齐），缺失月份补 0，方便前端图表直接渲染。
   * 时间锚定当前月，往前回溯 11 个月。
   *
   * @returns {Promise<{months: string[], income: number[], expense: number[]}>}
   */
  async getTrend() {
    const rows = await sequelize.query(
      `SELECT
          DATE_FORMAT(payment_date, '%Y-%m') AS month,
          type,
          COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         AND confirm_status = 'confirmed'
       GROUP BY DATE_FORMAT(payment_date, '%Y-%m'), type
       ORDER BY month ASC`,
      { type: QueryTypes.SELECT }
    );

    // 生成近 12 个月的月份标签（含当月），保证前端 X 轴连续
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // 把 SQL 结果映射成 { month: total } 便于按月索引取值
    const incomeMap = {}, expenseMap = {};
    rows.forEach(r => {
      const t = parseFloat(r.total) || 0;
      if (r.type === 'income') incomeMap[r.month] = t;
      else if (r.type === 'expense') expenseMap[r.month] = t;
    });

    return {
      months,
      income: months.map(m => incomeMap[m] || 0),
      expense: months.map(m => expenseMap[m] || 0)
    };
  }

  /**
   * 成本构成（按大类聚合）
   *
   * T17 起数据源从 payments 改为 cost_records（更完整，含固定月费和手动成本）
   *
   * @param {Object} query {period, start, end}
   * @returns {Promise<{list: Array, total: number, period: Object}>}
   */
  async getCostBreakdown(query) {
    const { startDate, endDate } = getDateRange(query.period, query.start, query.end);

    // 把日期转换为月份（YYYY-MM）用于匹配 cost_records.cost_month
    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);

    const rows = await sequelize.query(
      `SELECT
         COALESCE(c.type, 'other') AS category_type,
         COALESCE(SUM(r.amount), 0) AS total
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       WHERE r.cost_month BETWEEN :startMonth AND :endMonth
       GROUP BY c.type
       ORDER BY total DESC`,
      { replacements: { startMonth, endMonth }, type: QueryTypes.SELECT }
    );

    // 大类中文名映射
    const TYPE_LABEL = {
      labor: '人力成本',
      operation: '运营成本',
      patent: '专利维持',
      marketing: '营销成本',
      other: '其他'
    };

    const list = rows.map(r => ({
      category_type: r.category_type,
      category_name: TYPE_LABEL[r.category_type] || r.category_type,
      total: parseFloat(parseFloat(r.total).toFixed(2))
    }));

    const total = parseFloat(list.reduce((s, x) => s + x.total, 0).toFixed(2));

    return { list, total, period: { start: startDate, end: endDate } };
  }

  /**
   * 待确认单据数量（用于 Dashboard 顶部提醒）
   *
   * 包含：
   *   - 待确认的 payments（企微审批同步来的）
   *   - 待确认的 contracts（企微审批同步来的）
   *
   * @returns {Promise<{payments: number, contracts: number, total: number}>}
   */
  async getPending() {
    const payments = await Payment.count({ where: { confirm_status: 'pending' } });

    let contracts = 0;
    try {
      contracts = await Contract.count({ where: { confirm_status: 'pending' } });
    } catch (e) {
      contracts = 0;
    }

    return {
      payments,
      contracts,
      total: payments + contracts
    };
  }

  /**
   * 应收账龄分布
   *
   * 按合同到期日（expire_date）距今天数分 5 档：
   *   - not_due    ：尚未到期（天数 <= 0）
   *   - within_30  ：逾期 1-30 天
   *   - within_60  ：逾期 31-60 天
   *   - within_90  ：逾期 61-90 天
   *   - over_90    ：逾期 90 天以上
   *
   * 仅统计 remaining > 0 的合同。未设 expire_date 的归入 not_due。
   *
   * @returns {Promise<Object>} 五档的金额对象
   */
  async getAging() {
    const contracts = await Contract.findAll({
      where: {
        type: 'sale',
        status: { [Op.in]: ['active', 'completed'] }
      },
      attributes: ['id', 'amount', 'paid_amount', 'expire_date', 'sign_date']
    });

    const now = new Date();
    const buckets = {
      not_due: 0,
      within_30: 0,
      within_60: 0,
      within_90: 0,
      over_90: 0
    };

    contracts.forEach(c => {
      const amount = parseFloat(c.amount) || 0;
      const paid = parseFloat(c.paid_amount) || 0;
      const remaining = amount - paid;
      if (remaining <= 0) return; // 已全额收款的合同不纳入账龄统计

      if (!c.expire_date) {
        buckets.not_due += remaining;
        return;
      }

      const expire = new Date(c.expire_date);
      const days = Math.floor((now - expire) / (1000 * 60 * 60 * 24));

      if (days <= 0) buckets.not_due += remaining;
      else if (days <= 30) buckets.within_30 += remaining;
      else if (days <= 60) buckets.within_60 += remaining;
      else if (days <= 90) buckets.within_90 += remaining;
      else buckets.over_90 += remaining;
    });

    // 统一精度，避免浮点尾数
    Object.keys(buckets).forEach(k => {
      buckets[k] = parseFloat(buckets[k].toFixed(2));
    });

    return buckets;
  }
}

module.exports = new DashboardService();
