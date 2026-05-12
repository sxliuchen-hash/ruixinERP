const invoiceService = require('../services/invoiceService');

/**
 * 获取发票列表
 */
async function getList(req, res, next) {
  try {
    const result = await invoiceService.getList(req.query);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取发票详情
 */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const result = await invoiceService.getDetail(parseInt(id, 10));
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 创建发票
 */
async function create(req, res, next) {
  try {
    const invoice = await invoiceService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '发票创建成功',
      data: invoice
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 更新发票
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const invoice = await invoiceService.update(parseInt(id, 10), req.body);
    res.json({
      success: true,
      message: '发票更新成功',
      data: invoice
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 删除发票
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const result = await invoiceService.delete(parseInt(id, 10));
    res.json({
      success: true,
      message: '发票已删除',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 更新发票状态
 */
async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const invoice = await invoiceService.updateStatus(parseInt(id, 10), status);
    res.json({
      success: true,
      message: '发票状态更新成功',
      data: invoice
    });
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
  updateStatus
};
