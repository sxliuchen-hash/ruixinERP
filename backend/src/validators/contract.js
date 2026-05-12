/**
 * 合同管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建合同校验
 */
const createContractSchema = Joi.object({
  contract_no: Joi.string().max(50).allow('', null),
  type: Joi.string().valid('sale', 'purchase').required().messages({
    'any.required': '合同类型不能为空',
    'any.only': '合同类型必须为 sale 或 purchase'
  }),
  title: Joi.string().max(200).required().messages({
    'string.empty': '合同标题不能为空',
    'any.required': '合同标题不能为空',
    'string.max': '合同标题不能超过200个字符'
  }),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  amount: Joi.number().positive().required().messages({
    'any.required': '合同金额不能为空',
    'number.positive': '合同金额必须大于0'
  }),
  sign_date: Joi.date().iso().allow(null),
  expire_date: Joi.date().iso().allow(null),
  status: Joi.string().valid('draft', 'active', 'completed', 'terminated').default('draft'),
  project_id: Joi.number().integer().allow(null),
  attachment_url: Joi.string().max(500).allow('', null),
  owner_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新合同校验
 */
const updateContractSchema = Joi.object({
  contract_no: Joi.string().max(50).allow('', null),
  type: Joi.string().valid('sale', 'purchase').messages({
    'any.only': '合同类型必须为 sale 或 purchase'
  }),
  title: Joi.string().max(200).messages({
    'string.empty': '合同标题不能为空',
    'string.max': '合同标题不能超过200个字符'
  }),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  amount: Joi.number().positive().messages({
    'number.positive': '合同金额必须大于0'
  }),
  sign_date: Joi.date().iso().allow(null),
  expire_date: Joi.date().iso().allow(null),
  project_id: Joi.number().integer().allow(null),
  attachment_url: Joi.string().max(500).allow('', null),
  owner_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 状态变更校验
 */
const updateStatusSchema = Joi.object({
  status: Joi.string().valid('draft', 'active', 'completed', 'terminated').required().messages({
    'any.required': '状态不能为空',
    'any.only': '无效的状态值，允许: draft, active, completed, terminated'
  })
});

/**
 * 列表查询参数校验
 */
const listQuerySchema = Joi.object({
  type: Joi.string().valid('sale', 'purchase').allow('', null),
  status: Joi.string().valid('draft', 'active', 'completed', 'terminated').allow('', null),
  customer_id: Joi.number().integer().allow('', null),
  supplier_id: Joi.number().integer().allow('', null),
  keyword: Joi.string().max(100).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(20),
  pageSize: Joi.number().integer().min(1).max(500).allow(null)
});

module.exports = {
  createContractSchema,
  updateContractSchema,
  updateStatusSchema,
  listQuerySchema
};
