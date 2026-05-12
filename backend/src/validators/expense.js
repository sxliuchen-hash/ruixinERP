/**
 * 报销管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建报销
 */
const createExpenseSchema = Joi.object({
  user_id: Joi.number().integer().required().messages({
    'any.required': '报销人不能为空'
  }),
  amount: Joi.number().positive().required().messages({
    'any.required': '报销金额不能为空',
    'number.positive': '报销金额必须大于0'
  }),
  cost_category_id: Joi.number().integer().allow(null),
  expense_date: Joi.date().iso().required().messages({
    'any.required': '费用发生日期不能为空'
  }),
  account_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  confirm_status: Joi.string().valid('pending', 'confirmed').default('confirmed'),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新报销
 */
const updateExpenseSchema = Joi.object({
  user_id: Joi.number().integer(),
  amount: Joi.number().positive().messages({
    'number.positive': '报销金额必须大于0'
  }),
  cost_category_id: Joi.number().integer().allow(null),
  expense_date: Joi.date().iso(),
  account_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 列表查询
 */
const listExpenseQuerySchema = Joi.object({
  user_id: Joi.number().integer().allow('', null),
  cost_category_id: Joi.number().integer().allow('', null),
  account_id: Joi.number().integer().allow('', null),
  confirm_status: Joi.string().valid('pending', 'confirmed').allow('', null),
  start_date: Joi.date().iso().allow('', null),
  end_date: Joi.date().iso().allow('', null),
  keyword: Joi.string().max(100).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
  listExpenseQuerySchema
};
