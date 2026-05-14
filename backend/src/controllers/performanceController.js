/**
 * ============================================================
 * 业绩统计控制器（PerformanceController）
 * ============================================================
 * 路由前缀：/api/v1/performance
 * 权限：authenticate + requireErpAccess
 *
 * 接口列表：
 *   GET /overview       - 业绩概览（统计卡片）
 *   GET /ranking        - 月度排名
 *   GET /trend          - 业绩趋势（近N月）
 *   GET /quarterly      - 季度汇总（职级考核用）
 *   GET /commission     - 提成试算
 * ============================================================
 */

const performanceService = require('../services/performanceService');

/** GET /overview - 业绩概览统计卡片 */
async function getOverview(req, res, next) {
  try {
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const month = req.query.month || (now.getMonth() + 1);
    const data = await performanceService.getOverview({ year: parseInt(year), month: parseInt(month) });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /ranking - 月度业绩排名 */
async function getRanking(req, res, next) {
  try {
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const month = req.query.month || (now.getMonth() + 1);
    const scope = req.query.scope || 'company';
    const data = await performanceService.getMonthlyRanking({
      year: parseInt(year),
      month: parseInt(month),
      scope
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /trend - 业绩趋势 */
async function getTrend(req, res, next) {
  try {
    const months = parseInt(req.query.months) || 6;
    const scope = req.query.scope || 'company';
    const user_id = req.query.user_id ? parseInt(req.query.user_id) : undefined;
    const data = await performanceService.getTrend({ months, scope, user_id });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /quarterly - 季度汇总 */
async function getQuarterly(req, res, next) {
  try {
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const quarter = req.query.quarter || (Math.floor(now.getMonth() / 3) + 1);
    const data = await performanceService.getQuarterlySummary({
      year: parseInt(year),
      quarter: parseInt(quarter)
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

/** GET /commission - 提成试算（给定金额计算提成） */
async function calculateCommission(req, res, next) {
  try {
    const amount = parseFloat(req.query.amount) || 0;
    const commission = performanceService.calculateCommission(amount);
    res.json({
      success: true,
      data: {
        gross_profit: amount,
        commission,
        rate: amount > 0 ? parseFloat((commission / amount * 100).toFixed(2)) : 0
      }
    });
  } catch (error) { next(error); }
}

module.exports = {
  getOverview,
  getRanking,
  getTrend,
  getQuarterly,
  calculateCommission
};
