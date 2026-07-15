'use strict';

const { readBooleanEnv } = require('./authFeatures');

/**
 * 返回当前运行模式对 Redis 的依赖原因。
 *
 * SSO state/assertion 防重放只在 SSO 开启时使用；文件一次性票据和 Employee
 * provisioning 幂等接口当前没有独立关闭开关，生产构建中视为常开能力。
 * 非生产且未开启 SSO 时保留原有宽松启动方式，方便纯业务本地开发。
 */
function getRedisRequirement(env = process.env) {
  const reasons = [];
  if (readBooleanEnvFrom(env, 'ENABLE_SSO_LOGIN', false)) {
    reasons.push('sso');
  }
  if (env.NODE_ENV === 'production') {
    reasons.push('file_tickets', 'employee_provisioning');
  }

  return {
    required: reasons.length > 0,
    reasons: [...new Set(reasons)]
  };
}

function readBooleanEnvFrom(env, name, defaultValue) {
  if (env === process.env) return readBooleanEnv(name, defaultValue);
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

module.exports = {
  getRedisRequirement,
  readBooleanEnvFrom
};
