/**
 * ============================================================
 * 借款 Controller
 * ============================================================
 * 职责：接收 HTTP 请求，调用 loanService 执行业务。
 * 涵盖借款 CRUD + 还款操作（新增/删除）+ 概况统计。
 * ============================================================
 */

const loanService = require('../services/loanService');

/** GET /api/v1/loans */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await loanService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/loans/:id - 详情（含还款明细） */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await loanService.getDetail(parseInt(id, 10), userId, userRole);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/loans */
async function create(req, res, next) {
  try {
    const data = await loanService.create(req.body, req.user.id);
    res.status(201).json({ success: true, message: '借款单创建成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/loans/:id */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await loanService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '借款单更新成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/loans/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await loanService.delete(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '借款单已删除', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/loans/:id/repayments - 新增还款记录 */
async function addRepayment(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await loanService.addRepayment(parseInt(id, 10), req.body, userId, userRole);
    res.status(201).json({ success: true, message: '还款记录添加成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/loans/:id/repayments/:repaymentId - 删除还款记录 */
async function deleteRepayment(req, res, next) {
  try {
    const { id, repaymentId } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await loanService.deleteRepayment(
      parseInt(id, 10),
      parseInt(repaymentId, 10),
      userId,
      userRole
    );
    res.json({ success: true, message: '还款记录已删除', data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/loans/summary - 借款概况（分状态汇总） */
async function getSummary(req, res, next) {
  try {
    const data = await loanService.getSummary(req.query);
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
  addRepayment,
  deleteRepayment,
  getSummary
};
