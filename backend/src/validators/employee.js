/**
 * 员工档案 Joi 校验规则
 * 配合 validate 中间件（stripUnknown）防止 mass-assignment 写入非预期字段
 */
const Joi = require('joi');

const ROLE_VALUES = ['boss', 'partner', 'sales', 'purchase', 'admin'];
const STATUS_VALUES = ['probation', 'regular', 'resigned'];
const GRADE_VALUES = ['A', 'B', 'C', 'D', 'E'];

/**
 * 新建员工：name、role 必填
 */
const createEmployeeSchema = Joi.object({
  user_id: Joi.number().integer().allow(null),
  wechat_userid: Joi.string().max(50).allow('', null),
  name: Joi.string().max(50).required().messages({
    'string.empty': '姓名不能为空',
    'any.required': '姓名不能为空'
  }),
  role: Joi.string().valid(...ROLE_VALUES).required().messages({
    'any.only': `角色必须为：${ROLE_VALUES.join('/')}`,
    'any.required': '角色不能为空'
  }),
  status: Joi.string().valid(...STATUS_VALUES).default('probation'),
  grade: Joi.string().valid(...GRADE_VALUES).default('A'),
  region: Joi.string().max(20).allow('', null),
  hire_date: Joi.date().iso().allow(null),
  regular_date: Joi.date().iso().allow(null),
  resign_date: Joi.date().iso().allow(null),
  base_salary: Joi.number().min(0).allow(null),
  position_allowance: Joi.number().min(0).allow(null),
  attendance_bonus: Joi.number().min(0).allow(null),
  social_insurance_base: Joi.number().min(0).allow(null),
  social_insurance_rate: Joi.number().min(0).max(1).allow(null),
  partner_share_rate: Joi.number().min(0).max(1).allow(null),
  remark: Joi.string().allow('', null)
});

/**
 * 更新员工：全部可选、无默认值（避免未传字段被默认值覆盖），至少 1 个字段
 */
const updateEmployeeSchema = Joi.object({
  user_id: Joi.number().integer().allow(null),
  wechat_userid: Joi.string().max(50).allow('', null),
  name: Joi.string().max(50),
  role: Joi.string().valid(...ROLE_VALUES),
  status: Joi.string().valid(...STATUS_VALUES),
  grade: Joi.string().valid(...GRADE_VALUES),
  region: Joi.string().max(20).allow('', null),
  hire_date: Joi.date().iso().allow(null),
  regular_date: Joi.date().iso().allow(null),
  resign_date: Joi.date().iso().allow(null),
  base_salary: Joi.number().min(0).allow(null),
  position_allowance: Joi.number().min(0).allow(null),
  attendance_bonus: Joi.number().min(0).allow(null),
  social_insurance_base: Joi.number().min(0).allow(null),
  social_insurance_rate: Joi.number().min(0).max(1).allow(null),
  partner_share_rate: Joi.number().min(0).max(1).allow(null),
  remark: Joi.string().allow('', null)
}).min(1).messages({
  'object.min': '至少需要提供一个更新字段'
});

module.exports = {
  createEmployeeSchema,
  updateEmployeeSchema
};
