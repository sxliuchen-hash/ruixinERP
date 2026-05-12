/**
 * 供应商管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建供应商校验
 */
const createSupplierSchema = Joi.object({
  name: Joi.string().max(200).required().messages({
    'string.empty': '供应商名称不能为空',
    'any.required': '供应商名称不能为空',
    'string.max': '供应商名称不能超过200个字符'
  }),
  contact_person: Joi.string().max(50).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  address: Joi.string().max(500).allow('', null),
  bank_name: Joi.string().max(100).allow('', null),
  bank_account: Joi.string().max(50).allow('', null),
  tax_rate: Joi.number().precision(2).min(0).max(99.99).allow(null).messages({
    'number.min': '税点不能为负数',
    'number.max': '税点不能超过99.99'
  }),
  remark: Joi.string().max(500).allow('', null)
});

/**
 * 更新供应商校验
 */
const updateSupplierSchema = Joi.object({
  name: Joi.string().max(200).messages({
    'string.empty': '供应商名称不能为空',
    'string.max': '供应商名称不能超过200个字符'
  }),
  contact_person: Joi.string().max(50).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  address: Joi.string().max(500).allow('', null),
  bank_name: Joi.string().max(100).allow('', null),
  bank_account: Joi.string().max(50).allow('', null),
  tax_rate: Joi.number().precision(2).min(0).max(99.99).allow(null).messages({
    'number.min': '税点不能为负数',
    'number.max': '税点不能超过99.99'
  }),
  remark: Joi.string().max(500).allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

module.exports = {
  createSupplierSchema,
  updateSupplierSchema
};
