/**
 * 客户管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建客户校验
 */
const createCustomerSchema = Joi.object({
  name: Joi.string().max(200).required().messages({
    'string.empty': '客户名称不能为空',
    'any.required': '客户名称不能为空',
    'string.max': '客户名称不能超过200个字符'
  }),
  contact_person: Joi.string().max(50).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  address: Joi.string().max(500).allow('', null),
  invoice_title: Joi.string().max(200).allow('', null),
  tax_no: Joi.string().max(50).allow('', null),
  invoice_bank: Joi.string().max(100).allow('', null),
  invoice_account: Joi.string().max(50).allow('', null),
  main_user_id: Joi.number().integer().allow(null),
  remark: Joi.string().max(500).allow('', null)
});

/**
 * 更新客户校验
 */
const updateCustomerSchema = Joi.object({
  name: Joi.string().max(200).messages({
    'string.empty': '客户名称不能为空',
    'string.max': '客户名称不能超过200个字符'
  }),
  contact_person: Joi.string().max(50).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  address: Joi.string().max(500).allow('', null),
  invoice_title: Joi.string().max(200).allow('', null),
  tax_no: Joi.string().max(50).allow('', null),
  invoice_bank: Joi.string().max(100).allow('', null),
  invoice_account: Joi.string().max(50).allow('', null),
  main_user_id: Joi.number().integer().allow(null),
  remark: Joi.string().max(500).allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

module.exports = {
  createCustomerSchema,
  updateCustomerSchema
};
