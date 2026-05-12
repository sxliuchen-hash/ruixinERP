/**
 * 成本管理 Joi 校验规则
 */
const Joi = require('joi');

const CATEGORY_TYPES = ['labor', 'operation', 'patent', 'marketing', 'other'];

// ===== 成本类别 =====

const createCategorySchema = Joi.object({
  name: Joi.string().max(50).required(),
  parent_id: Joi.number().integer().allow(null),
  type: Joi.string().valid(...CATEGORY_TYPES).required(),
  sort_order: Joi.number().integer().default(0),
  status: Joi.number().integer().valid(0, 1).default(1)
});

const updateCategorySchema = Joi.object({
  name: Joi.string().max(50),
  parent_id: Joi.number().integer().allow(null),
  type: Joi.string().valid(...CATEGORY_TYPES),
  sort_order: Joi.number().integer(),
  status: Joi.number().integer().valid(0, 1)
}).min(1);

const listCategoryQuerySchema = Joi.object({
  type: Joi.string().valid(...CATEGORY_TYPES).allow('', null),
  status: Joi.number().integer().valid(0, 1).allow('', null)
});

// ===== 成本记录 =====

// cost_month 格式校验：YYYY-MM
const monthRegex = /^\d{4}-\d{2}$/;

const createRecordSchema = Joi.object({
  category_id: Joi.number().integer().required().messages({
    'any.required': '请选择成本类别'
  }),
  amount: Joi.number().positive().required().messages({
    'any.required': '金额不能为空',
    'number.positive': '金额必须大于0'
  }),
  cost_month: Joi.string().pattern(monthRegex).required().messages({
    'any.required': '请选择所属月份',
    'string.pattern.base': '所属月份格式应为 YYYY-MM'
  }),
  user_id: Joi.number().integer().allow(null),
  payment_id: Joi.number().integer().allow(null),
  account_id: Joi.number().integer().allow(null),
  is_recurring: Joi.number().integer().valid(0, 1).default(0),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
});

const updateRecordSchema = Joi.object({
  category_id: Joi.number().integer(),
  amount: Joi.number().positive(),
  cost_month: Joi.string().pattern(monthRegex).messages({
    'string.pattern.base': '所属月份格式应为 YYYY-MM'
  }),
  user_id: Joi.number().integer().allow(null),
  account_id: Joi.number().integer().allow(null),
  is_recurring: Joi.number().integer().valid(0, 1),
  summary: Joi.string().max(500).allow('', null),
  remark: Joi.string().allow('', null)
}).min(1);

const listRecordQuerySchema = Joi.object({
  category_id: Joi.number().integer().allow('', null),
  type: Joi.string().valid(...CATEGORY_TYPES).allow('', null),
  cost_month: Joi.string().pattern(monthRegex).allow('', null),
  user_id: Joi.number().integer().allow('', null),
  is_recurring: Joi.number().integer().valid(0, 1).allow('', null),
  start_month: Joi.string().pattern(monthRegex).allow('', null),
  end_month: Joi.string().pattern(monthRegex).allow('', null),
  keyword: Joi.string().max(200).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

// ===== 汇总 =====

const monthlySummaryQuerySchema = Joi.object({
  months: Joi.number().integer().min(1).max(60).default(12),
  type: Joi.string().valid(...CATEGORY_TYPES).allow('', null)
});

const breakdownQuerySchema = Joi.object({
  start_month: Joi.string().pattern(monthRegex).allow('', null),
  end_month: Joi.string().pattern(monthRegex).allow('', null),
  type: Joi.string().valid(...CATEGORY_TYPES).allow('', null)
});

const yoyMomQuerySchema = Joi.object({
  month: Joi.string().pattern(monthRegex).allow('', null)
});

const generateRecurringSchema = Joi.object({
  month: Joi.string().pattern(monthRegex).allow('', null)
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  listCategoryQuerySchema,
  createRecordSchema,
  updateRecordSchema,
  listRecordQuerySchema,
  monthlySummaryQuerySchema,
  breakdownQuerySchema,
  yoyMomQuerySchema,
  generateRecurringSchema
};
