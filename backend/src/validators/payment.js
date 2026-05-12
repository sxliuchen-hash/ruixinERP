/**
 * 收付款管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建收付款校验
 */
const createPaymentSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required().messages({
    'any.required': '收付款类型不能为空',
    'any.only': '类型必须为 income 或 expense'
  }),
  category: Joi.string().valid('business', 'fee').required().messages({
    'any.required': '收付款分类不能为空',
    'any.only': '分类必须为 business 或 fee'
  }),
  amount: Joi.number().positive().required().messages({
    'any.required': '金额不能为空',
    'number.positive': '金额必须大于0'
  }),
  payment_date: Joi.date().iso().required().messages({
    'any.required': '收付款日期不能为空'
  }),
  payment_method: Joi.string().valid('transfer', 'check', 'cash', 'other').default('transfer'),
  account_id: Joi.number().integer().required().messages({
    'any.required': '银行账户不能为空'
  }),
  contract_id: Joi.number().integer().allow(null),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  project_id: Joi.number().integer().allow(null),
  cost_category_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  confirm_status: Joi.string().valid('pending', 'confirmed').default('confirmed'),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新收付款校验
 */
const updatePaymentSchema = Joi.object({
  type: Joi.string().valid('income', 'expense'),
  category: Joi.string().valid('business', 'fee'),
  amount: Joi.number().positive().messages({
    'number.positive': '金额必须大于0'
  }),
  payment_date: Joi.date().iso(),
  payment_method: Joi.string().valid('transfer', 'check', 'cash', 'other'),
  account_id: Joi.number().integer(),
  contract_id: Joi.number().integer().allow(null),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  project_id: Joi.number().integer().allow(null),
  cost_category_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 列表查询参数校验
 */
const listQuerySchema = Joi.object({
  type: Joi.string().valid('income', 'expense').allow('', null),
  category: Joi.string().valid('business', 'fee').allow('', null),
  account_id: Joi.number().integer().allow('', null),
  contract_id: Joi.number().integer().allow('', null),
  project_id: Joi.number().integer().allow('', null),
  customer_id: Joi.number().integer().allow('', null),
  supplier_id: Joi.number().integer().allow('', null),
  confirm_status: Joi.string().valid('pending', 'confirmed').allow('', null),
  start_date: Joi.date().iso().allow('', null),
  end_date: Joi.date().iso().allow('', null),
  keyword: Joi.string().max(100).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

module.exports = {
  createPaymentSchema,
  updatePaymentSchema,
  listQuerySchema
};
