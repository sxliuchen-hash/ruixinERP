/**
 * 交易项目管理 Joi 校验规则
 */
const Joi = require('joi');

const STATUS_VALUES = ['active', 'completed', 'cancelled'];

/**
 * 创建项目
 */
const createProjectSchema = Joi.object({
  name: Joi.string().max(200).required().messages({
    'any.required': '项目名称不能为空'
  }),
  patent_no: Joi.string().max(50).allow('', null),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  status: Joi.string().valid(...STATUS_VALUES).default('active'),
  owner_id: Joi.number().integer().allow(null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新项目（剥离聚合字段，service 层强制）
 */
const updateProjectSchema = Joi.object({
  name: Joi.string().max(200),
  patent_no: Joi.string().max(50).allow('', null),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  owner_id: Joi.number().integer().allow(null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 列表查询
 */
const listProjectQuerySchema = Joi.object({
  status: Joi.string().valid(...STATUS_VALUES).allow('', null),
  customer_id: Joi.number().integer().allow('', null),
  supplier_id: Joi.number().integer().allow('', null),
  sort: Joi.string().valid('profit', 'sale', 'create').allow('', null),
  order: Joi.string().valid('asc', 'desc').allow('', null),
  keyword: Joi.string().max(200).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

/**
 * 变更状态
 */
const changeProjectStatusSchema = Joi.object({
  status: Joi.string().valid(...STATUS_VALUES).required()
});

/**
 * 利润汇总查询
 */
const summaryQuerySchema = Joi.object({
  start_date: Joi.date().iso().allow('', null),
  end_date: Joi.date().iso().allow('', null)
});

module.exports = {
  createProjectSchema,
  updateProjectSchema,
  listProjectQuerySchema,
  changeProjectStatusSchema,
  summaryQuerySchema
};
