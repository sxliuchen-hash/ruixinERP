/**
 * ============================================================
 * 专利库存 Controller
 * ============================================================
 * 薄层转接，调用 inventoryService 执行业务。
 * 参数校验由 validate + Joi 处理，数据隔离由 attachDataFilter 处理。
 * ============================================================
 */

const inventoryService = require('../services/inventoryService');

/** GET /api/v1/inventory */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await inventoryService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/overview - 库存总览统计 */
async function getOverview(req, res, next) {
  try {
    const data = await inventoryService.getOverview();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/expiring - 即将到期列表 */
async function getExpiring(req, res, next) {
  try {
    const data = await inventoryService.getExpiring(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/:id - 详情（含年费、调价历史） */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const data = await inventoryService.getDetail(parseInt(id, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory - 入库 */
async function create(req, res, next) {
  try {
    const data = await inventoryService.create(req.body, req.user.id);
    res.status(201).json({ success: true, message: '库存记录创建成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '库存记录更新成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/inventory/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.delete(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '库存记录已删除', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id/status - 变更状态（售出/放弃/转让中） */
async function changeStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, stock_out_date } = req.body;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.changeStatus(
      parseInt(id, 10),
      status,
      stock_out_date,
      userId,
      userRole
    );
    res.json({ success: true, message: '状态变更成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id/price - 单个调价 */
async function changePrice(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.changePrice(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '调价成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/batch-price - 批量调价 */
async function batchChangePrice(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.batchChangePrice(req.body, userId, userRole);
    res.json({
      success: true,
      message: `批量调价完成，影响 ${data.affected} 条`,
      data
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/:id/fees - 添加年费记录 */
async function addAnnualFee(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.addAnnualFee(
      parseInt(id, 10),
      req.body,
      userId,
      userRole
    );
    res.status(201).json({ success: true, message: '年费记录添加成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/inventory/:id/fees/:feeId - 删除年费记录 */
async function deleteAnnualFee(req, res, next) {
  try {
    const { id, feeId } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.deleteAnnualFee(
      parseInt(id, 10),
      parseInt(feeId, 10),
      userId,
      userRole
    );
    res.json({ success: true, message: '年费记录已删除', data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  getOverview,
  getExpiring,
  getDetail,
  create,
  update,
  remove,
  changeStatus,
  changePrice,
  batchChangePrice,
  addAnnualFee,
  deleteAnnualFee
};
