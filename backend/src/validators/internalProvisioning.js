'use strict';

const Joi = require('joi');

const EMPLOYEE_ROLE_VALUES = ['boss', 'partner', 'sales', 'purchase', 'admin'];

const provisionEmployeeSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  name: Joi.string().trim().min(1).max(50).required(),
  employeeRole: Joi.string().valid(...EMPLOYEE_ROLE_VALUES).required(),
  wechatUserId: Joi.string().trim().max(50).allow('', null).default(null)
});

module.exports = {
  EMPLOYEE_ROLE_VALUES,
  provisionEmployeeSchema
};
