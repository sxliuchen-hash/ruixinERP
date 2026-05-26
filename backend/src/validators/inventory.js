/**
 * 专利库存管理 Joi 校验规则
 */
const Joi = require('joi');

const STATUS_VALUES = ['in_stock', 'sold', 'abandoned', 'transferring'];
const FEE_TYPES = ['annual', 'agency', 'other'];
const RESOURCE_TYPES = ['own', 'exclusive_agent', 'joint_agent'];

/**
 * 创建库存
 */
const createInventorySchema = Joi.object({
  patent_no: Joi.string().max(50).required().messages({
    'any.required': '专利号不能为空'
  }),
  patent_name: Joi.string().max(500).required().messages({
    'any.required': '专利名称不能为空'
  }),
  patent_type: Joi.string().max(20).allow('', null),
  resource_type: Joi.string().valid(...RESOURCE_TYPES).default('own'),
  agent_id: Joi.number().integer().allow(null),
  profit_rule: Joi.object().allow(null),
  tech_field: Joi.string().max(100).allow('', null),
  purchase_price: Joi.number().min(0).default(0),
  purchase_date: Joi.date().iso().allow('', null),
  supplier_id: Joi.number().integer().allow(null),
  contract_id: Joi.number().integer().allow(null),
  project_id: Joi.number().integer().allow(null),
  status: Joi.string().valid(...STATUS_VALUES).default('in_stock'),
  current_price: Joi.number().min(0).default(0),
  next_fee_deadline: Joi.date().iso().allow('', null),
  stock_in_date: Joi.date().iso().allow('', null),
  reported_high_tech: Joi.boolean().default(false),
  remark: Joi.string().allow('', null)
});

/**
 * 更新库存（剥离 current_price / total_maintain_cost，由 service 层强制）
 */
const updateInventorySchema = Joi.object({
  patent_no: Joi.string().max(50),
  patent_name: Joi.string().max(500),
  patent_type: Joi.string().max(20).allow('', null),
  resource_type: Joi.string().valid(...RESOURCE_TYPES),
  agent_id: Joi.number().integer().allow(null),
  profit_rule: Joi.object().allow(null),
  tech_field: Joi.string().max(100).allow('', null),
  purchase_price: Joi.number().min(0),
  purchase_date: Joi.date().iso().allow('', null),
  supplier_id: Joi.number().integer().allow(null),
  contract_id: Joi.number().integer().allow(null),
  project_id: Joi.number().integer().allow(null),
  next_fee_deadline: Joi.date().iso().allow('', null),
  stock_in_date: Joi.date().iso().allow('', null),
  stock_out_date: Joi.date().iso().allow('', null),
  reported_high_tech: Joi.boolean().allow(null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

/**
 * 列表查询
 */
const listInventoryQuerySchema = Joi.object({
  status: Joi.string().valid(...STATUS_VALUES).allow('', null),
  resource_type: Joi.string().valid(...RESOURCE_TYPES).allow('', null),
  agent_id: Joi.number().integer().allow('', null),
  tech_field: Joi.string().max(100).allow('', null),
  supplier_id: Joi.number().integer().allow('', null),
  project_id: Joi.number().integer().allow('', null),
  min_age: Joi.number().integer().min(0).allow('', null),
  max_age: Joi.number().integer().min(0).allow('', null),
  sort: Joi.string().valid('age', 'profit', 'price', 'deadline').allow('', null),
  order: Joi.string().valid('asc', 'desc').allow('', null),
  keyword: Joi.string().max(200).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  pageSize: Joi.number().integer().min(1).max(100)
});

/**
 * 变更状态
 */
const changeStatusSchema = Joi.object({
  status: Joi.string().valid(...STATUS_VALUES).required(),
  stock_out_date: Joi.date().iso().allow('', null)
});

/**
 * 单个调价
 */
const changePriceSchema = Joi.object({
  new_price: Joi.number().min(0).required().messages({
    'any.required': '新价格不能为空'
  }),
  change_date: Joi.date().iso().allow('', null),
  reason: Joi.string().max(500).allow('', null)
});

/**
 * 批量调价
 */
const batchChangePriceSchema = Joi.object({
  mode: Joi.string().valid('fixed', 'percent').required(),
  new_price: Joi.number().min(0).when('mode', { is: 'fixed', then: Joi.required() }),
  percent: Joi.number().min(-100).when('mode', { is: 'percent', then: Joi.required() }),
  ids: Joi.array().items(Joi.number().integer()).allow(null),
  tech_field: Joi.string().max(100).allow('', null),
  status: Joi.string().valid(...STATUS_VALUES).allow('', null),
  change_date: Joi.date().iso().allow('', null),
  reason: Joi.string().max(500).allow('', null)
});

/**
 * 添加年费
 */
const createAnnualFeeSchema = Joi.object({
  fee_type: Joi.string().valid(...FEE_TYPES).default('annual'),
  amount: Joi.number().positive().required().messages({
    'any.required': '金额不能为空',
    'number.positive': '金额必须大于0'
  }),
  fee_date: Joi.date().iso().required().messages({
    'any.required': '缴费日期不能为空'
  }),
  deadline_date: Joi.date().iso().allow('', null),
  payment_id: Joi.number().integer().allow(null),
  remark: Joi.string().max(255).allow('', null)
});

/**
 * 即将到期查询
 */
const expiringQuerySchema = Joi.object({
  days: Joi.number().integer().min(1).max(365).default(60)
});

/**
 * 标记已售
 */
const markAsSoldSchema = Joi.object({
  sold_price: Joi.number().min(0).required().messages({
    'any.required': '成交价格不能为空'
  }),
  buyer_name: Joi.string().max(100).required().messages({
    'any.required': '买家名称不能为空'
  }),
  sold_time: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/).allow('', null).messages({
    'string.pattern.base': '成交时间格式错误，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss'
  }),
  buyer_contact: Joi.string().max(100).allow('', null),
  sale_contract_id: Joi.number().integer().allow(null),
  sale_remark: Joi.string().allow('', null)
});

/**
 * 已售归档列表查询
 */
const soldListQuerySchema = Joi.object({
  keyword: Joi.string().max(200).allow('', null),
  buyer_name: Joi.string().max(100).allow('', null),
  resource_type: Joi.string().valid(...RESOURCE_TYPES).allow('', null),
  sold_time_start: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
  sold_time_end: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
  profit_type: Joi.string().valid('positive', 'negative').allow('', null),
  sort: Joi.string().valid('profit', 'price', 'time').allow('', null),
  order: Joi.string().valid('asc', 'desc').allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  pageSize: Joi.number().integer().min(1).max(100)
});

/**
 * 已售统计分析查询
 */
const soldAnalyticsQuerySchema = Joi.object({
  period: Joi.string().valid('month', 'quarter', 'year').default('month')
});

module.exports = {
  createInventorySchema,
  updateInventorySchema,
  listInventoryQuerySchema,
  changeStatusSchema,
  changePriceSchema,
  batchChangePriceSchema,
  createAnnualFeeSchema,
  expiringQuerySchema,
  markAsSoldSchema,
  soldListQuerySchema,
  soldAnalyticsQuerySchema
};
