/**
 * ============================================================
 * 收付款 Controller
 * ============================================================
 * 职责：
 *   - 接收 HTTP 请求，从 req 提取参数
 *   - 调用 service 层执行业务
 *   - 包装统一响应格式返回
 *
 * 不处理的事项：
 *   - 参数格式校验（已由 validate 中间件 + Joi schema 处理）
 *   - 权限检查（已由 authenticate + requireErpAccess + attachDataFilter 处理）
 *   - 业务语义校验（由 service 层处理）
 * ============================================================
 */

const paymentService = require('../services/paymentService');

/**
 * GET /api/v1/payments - 列表（分页 + 筛选）
 */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await paymentService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/payments/:id - 详情
 */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const payment = await paymentService.getDetail(parseInt(id, 10), userId, userRole);
    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments - 创建收付款
 * 业务类已确认的记录会事务内联动更新合同 paid_amount
 */
async function create(req, res, next) {
  try {
    const payment = await paymentService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '收付款记录创建成功',
      data: payment
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/payments/:id - 更新
 * 已确认业务类记录的金额变更会事务内先冲减旧值、再加上新值
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const payment = await paymentService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({
      success: true,
      message: '收付款记录更新成功',
      data: payment
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/payments/:id - 删除
 * 已确认业务类记录删除时会事务内冲减合同 paid_amount
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const result = await paymentService.delete(parseInt(id, 10), userId, userRole);
    res.json({
      success: true,
      message: '收付款记录已删除',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/payments/:id/confirm - 确认收付款
 * 用于企微审批同步来的 pending 记录的人工确认
 */
async function confirm(req, res, next) {
  try {
    const { id } = req.params;
    const payment = await paymentService.confirm(parseInt(id, 10));
    res.json({
      success: true,
      message: '收付款已确认',
      data: payment
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/payments/receivable - 应收汇总
 * 支持按客户筛选：?customer_id=xxx
 */
async function getReceivable(req, res, next) {
  try {
    const result = await paymentService.getReceivable(req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/payments/payable - 应付汇总
 * 支持按供应商筛选：?supplier_id=xxx
 */
async function getPayable(req, res, next) {
  try {
    const result = await paymentService.getPayable(req.query);
    res.json({ success: true, data: result });
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
  getReceivable,
  getPayable
};
