/**
 * 借款管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建借款
 */
const createLoanSchema = Joi.object({
  user_id: Joi.number().integer().required().messages({
    'any.required': '借款人不能为空'
  }),
  amount: Joi.number().positive().required().messages({
    'any.required': '借款金额不能为空',
    'number.positive': '借款金额必须大于0'
  }),
  loan_date: Joi.date().iso().required().messages({
    'any.required': '借款日期不能为空'
  }),
  purpose: Joi.string().max(500).allow('', null),
  account_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新借款（不允许修改 repaid_amount 和 status，service 层会剥离）
 */
const updateLoanSchema = Joi.object({
  user_id: Joi.number().integer(),
  amount: Joi.number().positive().messages({
    'number.positive': '借款金额必须大于0'
  }),
  loan_date: Joi.date().iso(),
  purpose: Joi.string().max(500).allow('', null),
  account_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 列表查询
 */
const listLoanQuerySchema = Joi.object({
  user_id: Joi.number().integer().allow('', null),
  status: Joi.string().valid('unpaid', 'partial', 'paid').allow('', null),
  account_id: Joi.number().integer().allow('', null),
  start_date: Joi.date().iso().allow('', null),
  end_date: Joi.date().iso().allow('', null),
  keyword: Joi.string().max(100).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

/**
 * 新增还款记录
 */
const createRepaymentSchema = Joi.object({
  amount: Joi.number().positive().required().messages({
    'any.required': '还款金额不能为空',
    'number.positive': '还款金额必须大于0'
  }),
  repay_date: Joi.date().iso().required().messages({
    'any.required': '还款日期不能为空'
  }),
  account_id: Joi.number().integer().allow(null),
  remark: Joi.string().max(255).allow('', null)
});

module.exports = {
  createLoanSchema,
  updateLoanSchema,
  listLoanQuerySchema,
  createRepaymentSchema
};
