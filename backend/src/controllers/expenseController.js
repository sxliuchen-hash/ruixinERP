/**
 * ============================================================
 * 报销 Controller
 * ============================================================
 * 职责：薄层转接，调用 expenseService 执行业务。
 *   - 参数校验由 validate 中间件 + Joi schema 处理
 *   - 数据隔离由 attachDataFilter 处理（service 层兜底）
 * ============================================================
 */

const expenseService = require('../services/expenseService');

/** GET /api/v1/expenses */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await expenseService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/expenses/:id */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await expenseService.getDetail(parseInt(id, 10), userId, userRole);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/expenses */
async function create(req, res, next) {
  try {
    const data = await expenseService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '报销单创建成功',
      data
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/expenses/:id */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await expenseService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '报销单更新成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/expenses/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await expenseService.delete(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '报销单已删除', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/expenses/:id/confirm */
async function confirm(req, res, next) {
  try {
    const { id } = req.params;
    const data = await expenseService.confirm(parseInt(id, 10));
    res.json({ success: true, message: '报销单已确认', data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/expenses/summary/category - 按类别汇总 */
async function getCategorySummary(req, res, next) {
  try {
    const data = await expenseService.getCategorySummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/expenses/summary/user - 按人员汇总 */
async function getUserSummary(req, res, next) {
  try {
    const data = await expenseService.getUserSummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/expenses/summary/monthly - 按月度汇总（趋势） */
async function getMonthlySummary(req, res, next) {
  try {
    const data = await expenseService.getMonthlySummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  getDetail,
  create,
  update,
  remove,
  confirm,
  getCategorySummary,
  getUserSummary,
  getMonthlySummary
};
