/**
 * ============================================================
 * Dashboard Controller
 * ============================================================
 * 职责：Dashboard 聚合数据的 HTTP 入口层，薄壳转发到 dashboardService。
 *
 * 路由前缀：/api/v1/dashboard
 * 权限：authenticate + requireErpAccess（admin/process/agent 均可访问）
 *
 * 后续优化：
 *   - 可加 Redis 缓存，key 规则 `erp:dashboard:<method>:<period>`，TTL 300s
 *   - agent 角色查看的 Dashboard 可做数据隔离版本（只看自己负责的合同/payments）
 * ============================================================
 */

const dashboardService = require('../services/dashboardService');

/** GET /overview - 核心指标（现金流、应收应付、毛利润） */
async function getOverview(req, res, next) {
  try {
    const data = await dashboardService.getOverview(req.query);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /accounts - 各账户实时余额 */
async function getAccounts(req, res, next) {
  try {
    const data = await dashboardService.getAccounts();
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /trend - 近 12 个月收支趋势 */
async function getTrend(req, res, next) {
  try {
    const data = await dashboardService.getTrend();
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /cost-breakdown - 成本构成（费用类 payments 按类别分组） */
async function getCostBreakdown(req, res, next) {
  try {
    const data = await dashboardService.getCostBreakdown(req.query);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /pending - 待确认单据数量 */
async function getPending(req, res, next) {
  try {
    const data = await dashboardService.getPending();
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /aging - 应收账龄分布 */
async function getAging(req, res, next) {
  try {
    const data = await dashboardService.getAging();
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

module.exports = {
  getOverview,
  getAccounts,
  getTrend,
  getCostBreakdown,
  getPending,
  getAging
};
