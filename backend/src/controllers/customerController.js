const customerService = require('../services/customerService');

/**
 * 获取客户列表
 */
async function getList(req, res, next) {
  try {
    const result = await customerService.getList(req.query);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取客户详情（含往来账汇总）
 */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const result = await customerService.getDetail(parseInt(id, 10));
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 创建客户（请求体已通过 Joi 校验）
 */
async function create(req, res, next) {
  try {
    const customer = await customerService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '客户创建成功',
      data: customer
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 编辑客户（请求体已通过 Joi 校验）
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const customer = await customerService.update(parseInt(id, 10), req.body);
    res.json({
      success: true,
      message: '客户更新成功',
      data: customer
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 删除客户（软删除）
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const result = await customerService.delete(parseInt(id, 10));
    res.json({
      success: true,
      message: '客户删除成功',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取客户往来账明细（关联合同列表 + 收付款记录）
 */
async function getTransactions(req, res, next) {
  try {
    const { id } = req.params;
    const result = await customerService.getTransactions(parseInt(id, 10), req.query);
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
