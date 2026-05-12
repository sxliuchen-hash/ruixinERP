const contractService = require('../services/contractService');
const { ValidationError } = require('../utils/errors');

/**
 * 获取合同列表
 */
async function getList(req, res, next) {
  try {
    const result = await contractService.getList(req.query, req.dataFilter);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取合同详情
 */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const result = await contractService.getDetail(parseInt(id, 10), req.dataFilter);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 创建合同
 */
async function create(req, res, next) {
  try {
    const contract = await contractService.create(req.body, req.user.id);
    res.status(201).json({
      success: true,
      message: '合同创建成功',
      data: contract
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 更新合同
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const contract = await contractService.update(
      parseInt(id, 10),
      req.body,
      req.dataFilter
    );
    res.json({
      success: true,
      message: '合同更新成功',
      data: contract
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 删除合同（软删除）
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const result = await contractService.delete(parseInt(id, 10), req.dataFilter);
    res.json({
      success: true,
      message: '合同已删除',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 更新合同状态
 */
async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const contract = await contractService.updateStatus(
      parseInt(id, 10),
      status,
      req.dataFilter
    );
    res.json({
      success: true,
      message: '合同状态更新成功',
      data: contract
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 确认合同（企业微信同步来的待确认记录）
 */
async function confirm(req, res, next) {
  try {
    const { id } = req.params;
    const contract = await contractService.confirm(parseInt(id, 10));
    res.json({
      success: true,
      message: '合同已确认',
      data: contract
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 上传合同附件
 */
async function uploadAttachment(req, res, next) {
  try {
    const { id } = req.params;

    if (!req.file) {
      throw new ValidationError('请选择要上传的文件');
    }

    const contract = await contractService.uploadAttachment(
      parseInt(id, 10),
      req.file,
      req.dataFilter
    );
    res.json({
      success: true,
      message: '附件上传成功',
      data: contract
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
  updateStatus,
  confirm,
  uploadAttachment
};
