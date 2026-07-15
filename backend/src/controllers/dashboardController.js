/**
 * ============================================================
 * Dashboard Controller
 * ============================================================
 * 职责：Dashboard 聚合数据的 HTTP 入口层，薄壳转发到 dashboardService。
 *
 * 路由前缀：/api/v1/dashboard
 * 权限：由路由层校验 erp.app.view + erp.dashboard.view
 *
 * 后续优化：
 *   - 可加 Redis 缓存，key 规则 `erp:dashboard:<method>:<period>`，TTL 300s
 *   - 如后续为 Dashboard 增加 self/team scope，需在 service 查询层实现真实行级过滤
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
