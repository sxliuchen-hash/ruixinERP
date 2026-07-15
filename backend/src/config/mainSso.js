'use strict';

const fs = require('fs');
const path = require('path');
const { AppError } = require('../utils/errors');
const { readBooleanEnv } = require('./authFeatures');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePem(value) {
  return value ? String(value).replace(/\\n/g, '\n').trim() : '';
}

function readKey(inlineEnvName, pathEnvName, label) {
  const inlineKey = normalizePem(process.env[inlineEnvName]);
  if (inlineKey) return inlineKey;

  const keyPath = process.env[pathEnvName];
  if (!keyPath) return '';

  const absolutePath = path.isAbsolute(keyPath)
    ? keyPath
    : path.resolve(process.cwd(), keyPath);

  try {
    return fs.readFileSync(absolutePath, 'utf8').trim();
  } catch (_error) {
    throw new AppError(`无法读取主项目 SSO ${label}`, 503, 'SSO_CONFIGURATION_ERROR');
  }
}

function readPublicKeyring() {
  const activeKid = process.env.ERP_SSO_ACTIVE_KID || 'main-active';
  const previousKid = process.env.ERP_SSO_PREVIOUS_KID || '';
  const activeKey = readKey(
    'ERP_SSO_ACTIVE_PUBLIC_KEY',
    'ERP_SSO_ACTIVE_PUBLIC_KEY_PATH',
    'active 公钥'
  ) || readKey('ERP_SSO_PUBLIC_KEY', 'ERP_SSO_PUBLIC_KEY_PATH', '兼容公钥');
  const previousKey = readKey(
    'ERP_SSO_PREVIOUS_PUBLIC_KEY',
    'ERP_SSO_PREVIOUS_PUBLIC_KEY_PATH',
    'previous 公钥'
  );

  if (Boolean(previousKid) !== Boolean(previousKey)) {
    throw new AppError(
      'SSO previous kid 与 previous 公钥必须同时配置或同时留空',
      503,
      'SSO_CONFIGURATION_ERROR'
    );
  }
  if (previousKey && previousKid === activeKid) {
    throw new AppError('SSO active/previous kid 不能相同', 503, 'SSO_CONFIGURATION_ERROR');
  }

  const publicKeys = {};
  if (activeKey) publicKeys[activeKid] = activeKey;
  if (previousKid && previousKey) publicKeys[previousKid] = previousKey;

  return { activeKid, previousKid, publicKeys, activeKey };
}

function resolveCallbackUrl() {
  if (process.env.ERP_SSO_CALLBACK_URL) return String(process.env.ERP_SSO_CALLBACK_URL).trim();
  if (process.env.NODE_ENV === 'production') {
    return String(process.env.ERP_SSO_CALLBACK_URL_PRODUCTION || '').trim();
  }
  return String(
    process.env.ERP_SSO_CALLBACK_URL_TEST || 'http://localhost:5173/sso/callback'
  ).trim();
}

function getMainSsoConfig({ includePublicKey = true } = {}) {
  const keyring = includePublicKey
    ? readPublicKeyring()
    : { activeKid: '', previousKid: '', publicKeys: {}, activeKey: '' };

  return {
    baseUrl: String(process.env.MAIN_SSO_BASE_URL || 'http://127.0.0.1:3000')
      .trim()
      .replace(/\/+$/, ''),
    exchangePath: process.env.MAIN_SSO_EXCHANGE_PATH || '/api/v1/internal/sso/erp/exchange',
    clientId: process.env.ERP_SSO_CLIENT_ID || '',
    clientSecret: process.env.ERP_SSO_CLIENT_SECRET || '',
    clientIdHeader: process.env.MAIN_SSO_CLIENT_ID_HEADER || 'X-ERP-Client-Id',
    clientSecretHeader: process.env.MAIN_SSO_CLIENT_SECRET_HEADER || 'X-ERP-Client-Secret',
    businessClientId: process.env.MAIN_API_CLIENT_ID || '',
    businessClientSecret: process.env.MAIN_API_CLIENT_SECRET || '',
    businessClientIdHeader: process.env.MAIN_API_CLIENT_ID_HEADER || 'X-ERP-Service-Id',
    businessClientSecretHeader: process.env.MAIN_API_CLIENT_SECRET_HEADER || 'X-ERP-Service-Secret',
    audience: process.env.ERP_SSO_AUDIENCE || 'erp',
    issuer: process.env.ERP_SSO_ISSUER || 'patent-notice-system',
    publicKey: keyring.activeKey,
    publicKeys: keyring.publicKeys,
    activeKid: keyring.activeKid,
    previousKid: keyring.previousKid,
    allowLegacyNoKid: readBooleanEnv('ERP_SSO_ALLOW_LEGACY_NO_KID', false),
    callbackUrl: resolveCallbackUrl(),
    mainSystemUrl: (process.env.MAIN_SYSTEM_URL || '').trim(),
    continuePath: process.env.MAIN_SSO_CONTINUE_PATH || '/sso/continue',
    stateTtlSec: parsePositiveInt(process.env.ERP_SSO_STATE_TTL_SEC, 120),
    stateCookieName: process.env.ERP_SSO_STATE_COOKIE_NAME || 'erp_sso_browser',
    stateCookieSecure: process.env.NODE_ENV === 'production'
      ? true
      : readBooleanEnv('ERP_SSO_STATE_COOKIE_SECURE', false),
    timeoutMs: parsePositiveInt(process.env.MAIN_SSO_TIMEOUT_MS, 5000),
    assertionMaxLifetimeSec: parsePositiveInt(
      process.env.ERP_SSO_ASSERTION_MAX_LIFETIME_SEC,
      120
    ),
    sessionExpiresIn: process.env.ERP_SESSION_EXPIRES_IN || '2h',
    sessionSecret: process.env.ERP_SESSION_SECRET || process.env.JWT_SECRET || '',
    teamScopePath: process.env.MAIN_SSO_TEAM_SCOPE_PATH || '/api/v1/internal/users/:userId/team-scope',
    teamScopeCacheTtlMs: parsePositiveInt(process.env.MAIN_USER_SCOPE_CACHE_TTL_MS, 120000),
    permissionVersionPath: process.env.MAIN_PERMISSION_VERSION_PATH || '/api/v1/internal/users/:userId/permission-version',
    permissionVersionCacheTtlMs: parsePositiveInt(process.env.MAIN_PERMISSION_VERSION_CACHE_TTL_MS, 120000)
  };
}

function assertMainSsoConfig(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new AppError('主项目 SSO 服务凭证未配置', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (!config.publicKeys || Object.keys(config.publicKeys).length === 0) {
    throw new AppError('主项目 SSO 验签公钥未配置', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (
    !config.activeKid ||
    !Object.prototype.hasOwnProperty.call(config.publicKeys, config.activeKid)
  ) {
    throw new AppError('主项目 SSO active kid 对应公钥未配置', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (!config.callbackUrl) {
    throw new AppError('ERP SSO 回调地址未配置', 503, 'SSO_CONFIGURATION_ERROR');
  }
  try {
    const callbackUrl = new URL(config.callbackUrl);
    if (
      !['http:', 'https:'].includes(callbackUrl.protocol) ||
      callbackUrl.username ||
      callbackUrl.password ||
      callbackUrl.search ||
      callbackUrl.hash ||
      callbackUrl.pathname !== '/sso/callback'
    ) {
      throw new Error('callback must be the fixed /sso/callback URL');
    }
    if (process.env.NODE_ENV === 'production' && callbackUrl.protocol !== 'https:') {
      throw new Error('production callback must use https');
    }
    if (
      process.env.NODE_ENV === 'production' &&
      /(?:^|[.-])(?:example|placeholder|changeme|your-domain)(?:[.-]|$)/i
        .test(callbackUrl.hostname)
    ) {
      throw new Error('placeholder callback hostname forbidden');
    }
  } catch (_error) {
    throw new AppError('ERP SSO 回调地址无效', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (!config.sessionSecret) {
    throw new AppError('ERP 会话签名密钥未配置', 503, 'AUTH_CONFIGURATION_ERROR');
  }
  if (
    !Number.isInteger(config.assertionMaxLifetimeSec) ||
    config.assertionMaxLifetimeSec < 60 ||
    config.assertionMaxLifetimeSec > 120
  ) {
    throw new AppError(
      '主项目 SSO assertion 最大有效期必须为 60～120 秒',
      503,
      'SSO_CONFIGURATION_ERROR'
    );
  }
  if (process.env.NODE_ENV === 'production' && (
    !process.env.ERP_SESSION_SECRET ||
    process.env.ERP_SESSION_SECRET === process.env.JWT_SECRET
  )) {
    throw new AppError('生产环境必须配置独立 ERP_SESSION_SECRET', 503, 'AUTH_CONFIGURATION_ERROR');
  }
}

function assertMainSsoInitiationConfig(config) {
  assertMainSsoConfig(config);
  try {
    const mainSystemUrl = new URL(config.mainSystemUrl);
    if (!['http:', 'https:'].includes(mainSystemUrl.protocol)) throw new Error('invalid protocol');
    if (mainSystemUrl.username || mainSystemUrl.password || mainSystemUrl.search || mainSystemUrl.hash) {
      throw new Error('userinfo/query/hash forbidden');
    }
    if (mainSystemUrl.pathname !== '/') {
      throw new Error('main system URL must be an origin');
    }
    if (
      process.env.NODE_ENV === 'production' &&
      /(?:^|[.-])(?:example|placeholder|changeme|your-domain)(?:[.-]|$)/i
        .test(mainSystemUrl.hostname)
    ) {
      throw new Error('placeholder main system hostname forbidden');
    }
    if (process.env.NODE_ENV === 'production' && mainSystemUrl.protocol !== 'https:') {
      throw new Error('production main system must use https');
    }
  } catch (_error) {
    throw new AppError('主项目浏览器地址无效', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (config.continuePath !== '/sso/continue') {
    throw new AppError('主项目 SSO continue 路径无效', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (!Number.isInteger(config.stateTtlSec) || config.stateTtlSec < 60 || config.stateTtlSec > 300) {
    throw new AppError('ERP SSO state 有效期必须为 60～300 秒', 503, 'SSO_CONFIGURATION_ERROR');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.stateCookieName)) {
    throw new AppError('ERP SSO state Cookie 名称无效', 503, 'SSO_CONFIGURATION_ERROR');
  }
}

module.exports = {
  getMainSsoConfig,
  assertMainSsoConfig,
  assertMainSsoInitiationConfig,
  normalizePem,
  parsePositiveInt,
  readPublicKeyring,
  resolveCallbackUrl
};
