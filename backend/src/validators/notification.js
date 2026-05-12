/**
 * 系统消息 Joi 校验规则
 */
const Joi = require('joi');

const listNotificationQuerySchema = Joi.object({
  type: Joi.string().valid(
    'contract_expire', 'fee_deadline', 'approval_sync', 'system', 'other'
  ).allow('', null),
  level: Joi.string().valid('info', 'warning', 'danger').allow('', null),
  is_read: Joi.number().integer().valid(0, 1).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  pageSize: Joi.number().integer().min(1).max(100).allow(null)
});

module.exports = { listNotificationQuerySchema };
