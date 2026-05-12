/**
 * 发票管理 Joi 校验规则
 */
const Joi = require('joi');

/**
 * 创建发票校验
 */
const createInvoiceSchema = Joi.object({
  type: Joi.string().valid('output', 'input').required().messages({
    'any.required': '发票类型不能为空',
    'any.only': '发票类型必须为 output（销项）或 input（进项）'
  }),
  invoice_type: Joi.string().valid('normal', 'special').required().messages({
    'any.required': '发票种类不能为空',
    'any.only': '发票种类必须为 normal（普票）或 special（专票）'
  }),
  invoice_no: Joi.string().max(50).allow('', null),
  amount: Joi.number().positive().required().messages({
    'any.required': '发票金额不能为空',
    'number.positive': '发票金额必须大于0'
  }),
  tax_amount: Joi.number().min(0).allow(null).default(0),
  total_amount: Joi.number().min(0).allow(null),
  invoice_date: Joi.date().iso().allow(null),
  contract_id: Joi.number().integer().allow(null),
  customer_id: Joi.when('type', {
    is: 'output',
    then: Joi.number().integer().allow(null),
    otherwise: Joi.number().integer().allow(null)
  }),
  supplier_id: Joi.when('type', {
    is: 'input',
    then: Joi.number().integer().allow(null),
    otherwise: Joi.number().integer().allow(null)
  }),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().max(500).allow('', null)
});

/**
 * 更新发票校验
 */
const updateInvoiceSchema = Joi.object({
  type: Joi.string().valid('output', 'input').messages({
    'any.only': '发票类型必须为 output（销项）或 input（进项）'
  }),
  invoice_type: Joi.string().valid('normal', 'special').messages({
    'any.only': '发票种类必须为 normal（普票）或 special（专票）'
  }),
  invoice_no: Joi.string().max(50).allow('', null),
  amount: Joi.number().positive().messages({
    'number.positive': '发票金额必须大于0'
  }),
  tax_amount: Joi.number().min(0).allow(null),
  total_amount: Joi.number().min(0).allow(null),
  invoice_date: Joi.date().iso().allow(null),
  contract_id: Joi.number().integer().allow(null),
  customer_id: Joi.number().integer().allow(null),
  supplier_id: Joi.number().integer().allow(null),
  sp_no: Joi.string().max(50).allow('', null),
  remark: Joi.string().max(500).allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 更新发票状态校验
 */
const updateInvoiceStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'issued', 'cancelled').required().messages({
    'any.required': '状态不能为空',
    'any.only': '状态必须为 pending（待开票）、issued（已开票）或 cancelled（已作废）'
  })
});

module.exports = {
  createInvoiceSchema,
  updateInvoiceSchema,
  updateInvoiceStatusSchema
};
