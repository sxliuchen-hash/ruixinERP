/**
 * 银行账户 Joi 校验规则
 * 配合 validate 中间件（stripUnknown）防止 mass-assignment（如越权写 created_by）
 */
const Joi = require('joi');

const createAccountSchema = Joi.object({
  name: Joi.string().max(100).required().messages({
    'string.empty': '账户名称不能为空',
    'any.required': '账户名称不能为空'
  }),
  bank_name: Joi.string().max(100).allow('', null),
  account_no: Joi.string().max(50).allow('', null),
  account_type: Joi.string().valid('public', 'private').required().messages({
    'any.only': '账户类型必须为 public 或 private',
    'any.required': '账户类型不能为空'
  }),
  initial_balance: Joi.number().allow(null),
  status: Joi.number().integer().valid(0, 1).default(1),
  remark: Joi.string().max(255).allow('', null)
});

const updateAccountSchema = Joi.object({
  name: Joi.string().max(100),
  bank_name: Joi.string().max(100).allow('', null),
  account_no: Joi.string().max(50).allow('', null),
  account_type: Joi.string().valid('public', 'private'),
  initial_balance: Joi.number().allow(null),
  status: Joi.number().integer().valid(0, 1),
  remark: Joi.string().max(255).allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

const setBalanceSchema = Joi.object({
  initial_balance: Joi.number().required().messages({
    'any.required': '期初余额不能为空'
  })
});

const transferSchema = Joi.object({
  from_account_id: Joi.number().integer().required(),
  to_account_id: Joi.number().integer().required(),
  amount: Joi.number().positive().required().messages({
    'number.positive': '转账金额必须大于0'
  }),
  transfer_date: Joi.date().iso().allow(null),
  remark: Joi.string().max(255).allow('', null)
});

module.exports = {
  createAccountSchema,
  updateAccountSchema,
  setBalanceSchema,
  transferSchema
};
