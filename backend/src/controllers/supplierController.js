const supplierService = require('../services/supplierService');

/**
 * 获取供应商列表
 */
async function getList(req, res, next) {
  try {
    const result = await supplierService.getList(req.query);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取供应商详情（含往来账汇总）
 */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const result = await supplierService.getDetail(parseInt(id, 10));
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 创建供应商（请求体已通过 Joi 校验）
 */
async function create(req, res, next) {
  try {
    const supplier = await supplierService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '供应商创建成功',
      data: supplier
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 编辑供应商（请求体已通过 Joi 校验）
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const supplier = await supplierService.update(parseInt(id, 10), req.body);
    res.json({
      success: true,
      message: '供应商更新成功',
      data: supplier
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 删除供应商（软删除）
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const result = await supplierService.delete(parseInt(id, 10));
    res.json({
      success: true,
      message: '供应商删除成功',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取供应商往来账明细（关联合同列表 + 收付款记录）
 */
async function getTransactions(req, res, next) {
  try {
    const { id } = req.params;
    const result = await supplierService.getTransactions(parseInt(id, 10), req.query);
    res.json({
      success: true,
      data: result
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
  getTransactions
};
