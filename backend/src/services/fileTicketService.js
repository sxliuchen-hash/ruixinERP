'use strict';

const crypto = require('crypto');
const redis = require('../config/redis');

const TICKET_PREFIX = 'file_ticket:';
const TICKET_TTL = 60;

// Redis 5+ 均支持 Lua；相比 GETDEL 可兼容 Redis 6.2 以前版本。
const CONSUME_TICKET_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`;

function normalizeTicketPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!Object.prototype.hasOwnProperty.call(payload, 'permissionVersion')) return null;

  const normalized = {
    key: String(payload.key || ''),
    userId: Number(payload.userId),
    permissionVersion: Number(payload.permissionVersion),
    authSource: payload.authSource === 'main_sso' ? 'main_sso' : 'legacy',
    resourceType: String(payload.resourceType || ''),
    resourceId: Number(payload.resourceId),
    permissionCode: String(payload.permissionCode || ''),
    permissionScope: String(payload.permissionScope || '')
  };

  if (
    !normalized.key ||
    !Number.isInteger(normalized.userId) || normalized.userId <= 0 ||
    !Number.isInteger(normalized.permissionVersion) || normalized.permissionVersion < 0 ||
    !normalized.resourceType ||
    !Number.isInteger(normalized.resourceId) || normalized.resourceId <= 0 ||
    !normalized.permissionCode ||
    !['self', 'team', 'all'].includes(normalized.permissionScope)
  ) {
    return null;
  }

  return normalized;
}

async function createTicket(payload, client = redis) {
  const normalizedPayload = normalizeTicketPayload(payload);
  if (!normalizedPayload) throw new Error('文件票据数据无效');

  const ticket = crypto.randomBytes(24).toString('hex');
  await client.set(
    TICKET_PREFIX + ticket,
    JSON.stringify(normalizedPayload),
    'EX',
    TICKET_TTL
  );
  return ticket;
}

async function consumeTicket(ticket, client = redis) {
  const rawPayload = await client.eval(
    CONSUME_TICKET_SCRIPT,
    1,
    TICKET_PREFIX + String(ticket || '')
  );
  if (!rawPayload) return null;

  try {
    return normalizeTicketPayload(JSON.parse(rawPayload));
  } catch (_error) {
    return null;
  }
}

module.exports = {
  TICKET_PREFIX,
  TICKET_TTL,
  CONSUME_TICKET_SCRIPT,
  normalizeTicketPayload,
  createTicket,
  consumeTicket
};
