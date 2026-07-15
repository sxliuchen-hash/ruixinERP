'use strict';

const fs = require('fs');
const path = require('path');
const { createPublicKey } = require('crypto');
const Redis = require('ioredis');
const { AppError } = require('../utils/errors');
const defaultManifest = require('../permissions/erp-permission-manifest.json');
const { assertEmployeeUserIdUniqueIndex } = require('./employeeIndexGuard');
const { assertWechatSpNoUniqueIndexes } = require('./wechatSpNoIndexGuard');
const {
  assertPerformanceImportConfirmedPeriodUniqueIndex
} = require('./performanceImportIndexGuard');
const { assertPayrollSchemaReady } = require('./payrollSchemaGuard');

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function validateBooleanSetting(env, envName, issues, { required = false } = {}) {
  const rawValue = env[envName];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (required) {
      issues.push({
        code: `${envName}_MISSING`,
        message: `生产环境必须显式配置 ${envName}`
      });
    }
    return;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'].includes(normalized)) {
    issues.push({
      code: `${envName}_INVALID`,
      message: `${envName} 必须使用明确的 true/false 布尔值`
    });
  }
}

function validateEnumSetting(env, envName, allowedValues, issues, { required = false } = {}) {
  const rawValue = env[envName];
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    if (required) {
      issues.push({
        code: `${envName}_MISSING`,
        message: `生产环境必须显式配置 ${envName}`
      });
    }
    return;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (!allowedValues.includes(normalized)) {
    issues.push({
      code: `${envName}_INVALID`,
      message: `${envName} 必须是 ${allowedValues.join(' 或 ')}`
    });
  }
}

function readPublicKey(env, inlineName, pathName, cwd, issues, label) {
  const inline = env[inlineName] ? String(env[inlineName]).replace(/\\n/g, '\n').trim() : '';
  if (inline) return inline;

  const configuredPath = env[pathName];
  if (!configuredPath) return '';
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);
  try {
    return fs.readFileSync(absolutePath, 'utf8').trim();
  } catch (_error) {
    issues.push({
      code: 'PUBLIC_KEY_UNREADABLE',
      message: `${label}无法从 ${pathName} 指定的位置读取`
    });
    return '';
  }
}

function validateRsaPublicKey(pem, label, issues) {
  if (!pem) {
    issues.push({ code: 'PUBLIC_KEY_MISSING', message: `${label}未配置` });
    return;
  }
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') {
      issues.push({ code: 'PUBLIC_KEY_NOT_RSA', message: `${label}必须是 RSA 公钥` });
    }
  } catch (_error) {
    issues.push({ code: 'PUBLIC_KEY_INVALID', message: `${label}不是有效 PEM 公钥` });
  }
}

function isPlaceholderValue(value) {
  const normalized = String(value || '').trim();
  return /^(?:<[^>]+>|your_[A-Za-z0-9_]*|replace_with_[A-Za-z0-9_]*|change_me|placeholder|example)$/i
    .test(normalized);
}

function isPlaceholderHostname(hostname) {
  return /(?:^|[.-])(?:example|placeholder|changeme|your-domain)(?:[.-]|$)/i
    .test(String(hostname || '').trim());
}

function validateSecret(envName, value, issues, { label = envName, required = true, minLength = 32 } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    if (required) {
      issues.push({ code: `${envName}_MISSING`, message: `${label}必须显式配置` });
    }
    return;
  }
  if (isPlaceholderValue(normalized)) {
    issues.push({ code: `${envName}_PLACEHOLDER`, message: `${label}仍是占位值` });
    return;
  }
  if (normalized.length < minLength) {
    issues.push({
      code: `${envName}_WEAK`,
      message: `${label}长度不得少于 ${minLength} 个字符`
    });
  }
}

function requireCredentialPair(env, label, idName, secretName, issues) {
  const clientId = String(env[idName] || '').trim();
  const clientSecret = String(env[secretName] || '').trim();
  if (!clientId || !clientSecret) {
    issues.push({
      code: 'CREDENTIAL_PAIR_MISSING',
      message: `${label}必须同时配置 ${idName} 和 ${secretName}`
    });
  } else {
    if (isPlaceholderValue(clientId) || !/^[A-Za-z0-9._:-]{3,128}$/.test(clientId)) {
      issues.push({
        code: `${idName}_INVALID`,
        message: `${label}的 ${idName} 必须是 3～128 位稳定客户端标识且不能使用占位值`
      });
    }
    validateSecret(secretName, clientSecret, issues, { label: `${label}的 ${secretName}` });
  }
  return { label, clientId, clientSecret };
}

function validateRequiredUrl(env, envName, issues, {
  httpsOnly = false,
  allowQuery = false,
  allowHash = false,
  originOnly = false,
  rejectPlaceholderHost = false
} = {}) {
  const rawValue = env[envName] ? String(env[envName]).trim() : '';
  if (!rawValue) {
    issues.push({
      code: `${envName}_MISSING`,
      message: `生产环境必须显式配置 ${envName}`
    });
    return null;
  }

  try {
    const url = new URL(rawValue);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    if (httpsOnly && url.protocol !== 'https:') throw new Error('https required');
    if (url.username || url.password) throw new Error('userinfo forbidden');
    if (!allowQuery && url.search) throw new Error('query forbidden');
    if (!allowHash && url.hash) throw new Error('hash forbidden');
    if (originOnly && url.pathname !== '/') throw new Error('origin required');
    if (rejectPlaceholderHost && isPlaceholderHostname(url.hostname)) {
      throw new Error('placeholder hostname forbidden');
    }
    return url;
  } catch (_error) {
    issues.push({
      code: `${envName}_INVALID`,
      message: `${envName} 必须是${httpsOnly ? '有效 HTTPS' : '有效 HTTP(S)'}地址，且不得包含账号密码、查询串或片段`
    });
    return null;
  }
}

function validatePath(value, fallback, envName, issues, { userIdPlaceholder = false } = {}) {
  const pathValue = String(value || fallback || '').trim();
  if (!pathValue.startsWith('/') || pathValue.includes('?') || pathValue.includes('#')) {
    issues.push({
      code: `${envName}_INVALID`,
      message: `${envName} 必须是以 / 开头且不含查询串或片段的固定路径`
    });
    return;
  }
  if (userIdPlaceholder && !pathValue.includes(':userId')) {
    issues.push({
      code: `${envName}_USER_ID_MISSING`,
      message: `${envName} 必须包含 :userId 占位符`
    });
  }
}

function validateFixedSetting(env, envName, expectedValue, issues) {
  const actualValue = String(env[envName] || expectedValue).trim();
  if (actualValue !== expectedValue) {
    issues.push({
      code: `${envName}_NOT_FIXED`,
      message: `${envName} 必须固定为 ${expectedValue}`
    });
  }
}

function validateCredentialSeparation(credentialSets, sessionSecret, issues) {
  const configured = credentialSets.filter((item) => item.clientId && item.clientSecret);
  const ids = new Set();
  const secrets = new Set();

  for (const item of configured) {
    if (ids.has(item.clientId)) {
      issues.push({ code: 'CLIENT_ID_REUSED', message: 'SSO、业务 API、Manifest、建档四套 Client ID 必须相互独立' });
      break;
    }
    ids.add(item.clientId);
  }
  for (const item of configured) {
    if (secrets.has(item.clientSecret)) {
      issues.push({ code: 'CLIENT_SECRET_REUSED', message: 'SSO、业务 API、Manifest、建档四套 Client Secret 必须相互独立' });
      break;
    }
    secrets.add(item.clientSecret);
  }
  if (sessionSecret && configured.some((item) => item.clientSecret === sessionSecret)) {
    issues.push({
      code: 'SESSION_SECRET_REUSED',
      message: 'ERP_SESSION_SECRET 不得复用任何服务凭证 Secret'
    });
  }
}

function validateManifest(manifest, issues) {
  const permissions = Array.isArray(manifest?.modules)
    ? manifest.modules.flatMap((module) => module.permissions || [])
    : [];
  const permissionCodes = permissions.map((permission) => permission.code);
  const routes = permissions.flatMap((permission) => permission.routes || []);

  if (manifest?.schemaVersion !== 1) {
    issues.push({ code: 'MANIFEST_SCHEMA_VERSION_INVALID', message: 'ERP Manifest schemaVersion 必须为 1' });
  }
  if (manifest?.application?.code !== 'erp') {
    issues.push({ code: 'MANIFEST_APPLICATION_CODE_INVALID', message: 'ERP Manifest application.code 必须为 erp' });
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest?.application?.version || '')) {
    issues.push({ code: 'MANIFEST_VERSION_INVALID', message: 'ERP Manifest application.version 必须使用语义化版本' });
  }
  if (permissionCodes.length === 0 || new Set(permissionCodes).size !== permissionCodes.length) {
    issues.push({ code: 'MANIFEST_PERMISSION_DUPLICATE', message: 'ERP Manifest 权限编码为空或存在重复' });
  }
  if (new Set(routes).size !== routes.length) {
    issues.push({ code: 'MANIFEST_ROUTE_DUPLICATE', message: 'ERP Manifest 接口映射存在重复 route' });
  }

  return {
    version: manifest?.application?.version || '',
    permissionCount: permissionCodes.length,
    routeCount: routes.length
  };
}

async function defaultEmployeeIndexCheck(database) {
  await assertEmployeeUserIdUniqueIndex(database);
  await assertWechatSpNoUniqueIndexes(database);
  await assertPerformanceImportConfirmedPeriodUniqueIndex(database);
}

async function defaultPayrollSchemaCheck(database) {
  await assertPayrollSchemaReady(database);
}

async function withDefaultDatabaseConnection(callback, {
  createConnection
} = {}) {
  const factory = createConnection ||
    require('../config/database').createDatabaseConnection;
  const database = factory();
  try {
    await database.authenticate();
    return await callback(database);
  } finally {
    await database.close();
  }
}

function payrollSchemaIssue(error) {
  const knownCodes = new Set([
    'PAYROLL_SCHEMA_INSPECTION_FAILED',
    'PAYROLL_SCHEMA_CONFLICT',
    'PAYROLL_SCHEMA_MIGRATION_REQUIRED',
    'PAYROLL_SCHEMA_GUARD_INVALID_RESULT'
  ]);
  const code = knownCodes.has(error?.code)
    ? error.code
    : 'PAYROLL_SCHEMA_INVALID';
  const messages = {
    PAYROLL_SCHEMA_INSPECTION_FAILED: '薪酬数据库结构读取失败',
    PAYROLL_SCHEMA_CONFLICT: '薪酬数据库结构存在冲突',
    PAYROLL_SCHEMA_MIGRATION_REQUIRED: '薪酬数据库结构尚未完成显式迁移',
    PAYROLL_SCHEMA_GUARD_INVALID_RESULT: '薪酬数据库结构检查器返回非法结果',
    PAYROLL_SCHEMA_INVALID: '薪酬数据库结构未满足生产预检要求'
  };
  return { code, message: messages[code] };
}

async function defaultRedisCheck(env, { RedisClient = Redis } = {}) {
  const client = new RedisClient({
    host: env.REDIS_HOST,
    port: Number(env.REDIS_PORT),
    password: env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
    retryStrategy: null
  });
  try {
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('unexpected Redis PING response');
    return true;
  } finally {
    if (client.status === 'ready') {
      await client.quit().catch(() => client.disconnect(false));
    } else {
      client.disconnect(false);
    }
  }
}

function buildPreflightError(issues) {
  const error = new AppError(
    `统一认证生产配置预检失败，共 ${issues.length} 项`,
    503,
    'UNIFIED_AUTH_PREFLIGHT_FAILED'
  );
  error.issues = issues;
  return error;
}

async function runUnifiedAuthPreflight({
  env = process.env,
  manifest = defaultManifest,
  cwd = process.cwd(),
  employeeIndexCheck = defaultEmployeeIndexCheck,
  payrollSchemaCheck = defaultPayrollSchemaCheck,
  redisCheck = process.env.NODE_ENV === 'test'
    ? async () => true
    : defaultRedisCheck,
  configOnly = false
} = {}) {
  const issues = [];
  const warnings = [];

  if (env.NODE_ENV !== 'production') {
    issues.push({ code: 'NODE_ENV_INVALID', message: '统一认证生产预检要求 NODE_ENV=production' });
  }

  validateBooleanSetting(env, 'ENABLE_SSO_LOGIN', issues, { required: true });
  validateBooleanSetting(env, 'ENABLE_PASSWORD_LOGIN', issues, { required: true });
  validateBooleanSetting(env, 'ENABLE_LEGACY_SESSION', issues, { required: true });
  validateBooleanSetting(env, 'ERP_SSO_ALLOW_LEGACY_NO_KID', issues);
  validateEnumSetting(
    env,
    'WECHAT_UNBOUND_APPROVAL_POLICY',
    ['reject', 'allow_unowned'],
    issues,
    { required: true }
  );
  if (!configOnly) {
    validateBooleanSetting(env, 'UNIFIED_AUTH_PREFLIGHT_CHECK_DB', issues);
    validateBooleanSetting(env, 'UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS', issues, { required: true });
  }

  const enableSso = readBoolean(env.ENABLE_SSO_LOGIN, false);
  const enablePassword = readBoolean(env.ENABLE_PASSWORD_LOGIN, true);
  const enableLegacySession = readBoolean(env.ENABLE_LEGACY_SESSION, true);
  // The deployment preflight proves the target unified-auth cutover and therefore
  // requires SSO to be enabled. The process startup gate uses configOnly=true:
  // it must also allow the documented emergency rollback mode
  // SSO=false/password=true/legacy=true, while still validating every explicit
  // flag and rejecting combinations that leave no usable login path.
  if (!configOnly && !enableSso) {
    issues.push({ code: 'SSO_DISABLED', message: '生产统一认证必须启用 ENABLE_SSO_LOGIN' });
  }
  if (!enableSso && !enablePassword) {
    issues.push({ code: 'ALL_LOGIN_DISABLED', message: 'SSO 与密码登录不能同时关闭' });
  }
  if (enablePassword && !enableLegacySession) {
    issues.push({
      code: 'PASSWORD_SESSION_CONFLICT',
      message: '启用密码登录时必须同时启用 legacy session，否则登录后会话无法使用'
    });
  }
  if (!enablePassword && enableLegacySession) {
    warnings.push('密码登录已关闭，但 legacy session 仍处于存量会话过渡期');
  }

  const redisHost = String(env.REDIS_HOST || '').trim();
  const redisPort = Number(env.REDIS_PORT);
  if (!redisHost) {
    issues.push({ code: 'REDIS_HOST_MISSING', message: '生产统一认证必须显式配置 REDIS_HOST' });
  }
  if (!Number.isInteger(redisPort) || redisPort <= 0 || redisPort > 65535) {
    issues.push({ code: 'REDIS_PORT_INVALID', message: 'REDIS_PORT 必须是 1～65535 的整数' });
  }
  const checkRedis = !configOnly && readBoolean(env.UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS, false);
  if (!configOnly && !checkRedis) {
    issues.push({
      code: 'REDIS_PREFLIGHT_REQUIRED',
      message: '生产统一认证必须设置 UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS=true'
    });
  }

  validateRequiredUrl(env, 'MAIN_SSO_BASE_URL', issues, {
    rejectPlaceholderHost: true
  });
  validateRequiredUrl(env, 'MAIN_SYSTEM_URL', issues, {
    httpsOnly: true,
    originOnly: true,
    rejectPlaceholderHost: true
  });
  validatePath(
    env.MAIN_SSO_EXCHANGE_PATH,
    '/api/v1/internal/sso/erp/exchange',
    'MAIN_SSO_EXCHANGE_PATH',
    issues
  );
  validateFixedSetting(
    env,
    'MAIN_SSO_EXCHANGE_PATH',
    '/api/v1/internal/sso/erp/exchange',
    issues
  );
  validatePath(
    env.MAIN_SSO_CONTINUE_PATH,
    '/sso/continue',
    'MAIN_SSO_CONTINUE_PATH',
    issues
  );
  if (String(env.MAIN_SSO_CONTINUE_PATH || '/sso/continue').trim() !== '/sso/continue') {
    issues.push({
      code: 'MAIN_SSO_CONTINUE_PATH_NOT_FIXED',
      message: 'MAIN_SSO_CONTINUE_PATH 必须固定为 /sso/continue'
    });
  }
  validatePath(
    env.MAIN_SSO_TEAM_SCOPE_PATH,
    '/api/v1/internal/users/:userId/team-scope',
    'MAIN_SSO_TEAM_SCOPE_PATH',
    issues,
    { userIdPlaceholder: true }
  );
  validateFixedSetting(
    env,
    'MAIN_SSO_TEAM_SCOPE_PATH',
    '/api/v1/internal/users/:userId/team-scope',
    issues
  );
  validatePath(
    env.MAIN_PERMISSION_VERSION_PATH,
    '/api/v1/internal/users/:userId/permission-version',
    'MAIN_PERMISSION_VERSION_PATH',
    issues,
    { userIdPlaceholder: true }
  );
  validateFixedSetting(
    env,
    'MAIN_PERMISSION_VERSION_PATH',
    '/api/v1/internal/users/:userId/permission-version',
    issues
  );

  for (const [envName, expectedValue] of Object.entries({
    MAIN_SSO_CLIENT_ID_HEADER: 'X-ERP-Client-Id',
    MAIN_SSO_CLIENT_SECRET_HEADER: 'X-ERP-Client-Secret',
    MAIN_API_CLIENT_ID_HEADER: 'X-ERP-Service-Id',
    MAIN_API_CLIENT_SECRET_HEADER: 'X-ERP-Service-Secret',
    ERP_MANIFEST_CLIENT_ID_HEADER: 'X-ERP-Manifest-Client-Id',
    ERP_MANIFEST_CLIENT_SECRET_HEADER: 'X-ERP-Manifest-Client-Secret',
    ERP_PROVISION_CLIENT_ID_HEADER: 'X-Main-Provision-Client-Id',
    ERP_PROVISION_CLIENT_SECRET_HEADER: 'X-Main-Provision-Client-Secret',
    IP_API_CLIENT_ID_HEADER: 'X-ERP-Service-Id',
    IP_API_CLIENT_SECRET_HEADER: 'X-ERP-Service-Secret',
    IP_API_ACTING_USER_ID_HEADER: 'X-Acting-User-Id',
    IP_API_PERMISSION_VERSION_HEADER: 'X-Acting-Permission-Version',
    IP_API_JOB_NAME_HEADER: 'X-ERP-Job-Name'
  })) {
    validateFixedSetting(env, envName, expectedValue, issues);
  }

  const callbackUrl = env.ERP_SSO_CALLBACK_URL || env.ERP_SSO_CALLBACK_URL_PRODUCTION || '';
  try {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== 'https:') throw new Error('not https');
    if (callback.username || callback.password || callback.search || callback.hash) {
      throw new Error('callback extra fields forbidden');
    }
    if (isPlaceholderHostname(callback.hostname)) {
      throw new Error('placeholder callback hostname forbidden');
    }
    if (callback.pathname !== '/sso/callback') {
      issues.push({ code: 'CALLBACK_PATH_INVALID', message: '生产 ERP SSO callback 路径必须为 /sso/callback' });
    }
  } catch (_error) {
    issues.push({ code: 'CALLBACK_INVALID', message: '生产 ERP SSO callback 必须显式配置为有效 HTTPS 地址' });
  }

  const stateTtlSec = Number(env.ERP_SSO_STATE_TTL_SEC);
  if (!Number.isInteger(stateTtlSec) || stateTtlSec < 60 || stateTtlSec > 300) {
    issues.push({
      code: 'ERP_SSO_STATE_TTL_SEC_INVALID',
      message: 'ERP_SSO_STATE_TTL_SEC 必须显式配置为 60～300 秒的整数'
    });
  }
  const stateCookieName = String(env.ERP_SSO_STATE_COOKIE_NAME || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(stateCookieName)) {
    issues.push({
      code: 'ERP_SSO_STATE_COOKIE_NAME_INVALID',
      message: 'ERP_SSO_STATE_COOKIE_NAME 必须显式配置为安全 Cookie 名称'
    });
  }

  const audience = env.ERP_SSO_AUDIENCE || 'erp';
  if (audience !== 'erp') {
    issues.push({ code: 'SSO_AUDIENCE_INVALID', message: 'ERP_SSO_AUDIENCE 必须为 erp' });
  }
  const issuer = env.ERP_SSO_ISSUER || 'patent-notice-system';
  if (issuer !== 'patent-notice-system') {
    issues.push({ code: 'SSO_ISSUER_INVALID', message: 'ERP_SSO_ISSUER 必须为 patent-notice-system' });
  }
  const assertionMaxLifetimeSec = Number(env.ERP_SSO_ASSERTION_MAX_LIFETIME_SEC || 120);
  if (assertionMaxLifetimeSec !== 120) {
    issues.push({
      code: 'SSO_ASSERTION_MAX_LIFETIME_INVALID',
      message: 'ERP_SSO_ASSERTION_MAX_LIFETIME_SEC 必须为 120，以覆盖主项目 60～120 秒契约且拒绝超长断言'
    });
  }

  const sessionSecret = env.ERP_SESSION_SECRET || '';
  validateSecret('ERP_SESSION_SECRET', sessionSecret, issues, {
    label: '生产环境 ERP_SESSION_SECRET'
  });
  if (sessionSecret && env.JWT_SECRET && sessionSecret === env.JWT_SECRET) {
    issues.push({ code: 'SESSION_SECRET_NOT_INDEPENDENT', message: 'ERP_SESSION_SECRET 不得与 JWT_SECRET 相同' });
  }
  if (enablePassword || enableLegacySession) {
    validateSecret('JWT_SECRET', env.JWT_SECRET, issues, {
      label: '密码登录/legacy 会话 JWT_SECRET'
    });
  }

  const credentialSets = [
    requireCredentialPair(env, 'SSO Code 兑换凭证', 'ERP_SSO_CLIENT_ID', 'ERP_SSO_CLIENT_SECRET', issues),
    requireCredentialPair(env, '主项目业务 API 凭证', 'MAIN_API_CLIENT_ID', 'MAIN_API_CLIENT_SECRET', issues),
    requireCredentialPair(env, 'Manifest 同步凭证', 'ERP_MANIFEST_CLIENT_ID', 'ERP_MANIFEST_CLIENT_SECRET', issues),
    requireCredentialPair(env, 'Employee 建档凭证', 'ERP_PROVISION_CLIENT_ID', 'ERP_PROVISION_CLIENT_SECRET', issues)
  ];
  validateCredentialSeparation(credentialSets, sessionSecret, issues);

  const hasIpClientId = Boolean(env.IP_API_CLIENT_ID);
  const hasIpClientSecret = Boolean(env.IP_API_CLIENT_SECRET);
  if (hasIpClientId !== hasIpClientSecret) {
    issues.push({
      code: 'IP_CREDENTIAL_PAIR_INVALID',
      message: 'IP_API_CLIENT_ID 与 IP_API_CLIENT_SECRET 必须成对配置，不能与 MAIN_API 混搭'
    });
  }
  if (hasIpClientId && hasIpClientSecret) {
    if (isPlaceholderValue(env.IP_API_CLIENT_ID) || !/^[A-Za-z0-9._:-]{3,128}$/.test(env.IP_API_CLIENT_ID)) {
      issues.push({
        code: 'IP_API_CLIENT_ID_INVALID',
        message: 'IP_API_CLIENT_ID 必须是 3～128 位稳定客户端标识且不能使用占位值'
      });
    }
    validateSecret('IP_API_CLIENT_SECRET', env.IP_API_CLIENT_SECRET, issues, {
      label: 'IP 业务 API Client Secret'
    });
  }
  if (
    hasIpClientId &&
    (
      (env.ERP_SSO_CLIENT_ID && env.IP_API_CLIENT_ID === env.ERP_SSO_CLIENT_ID) ||
      (env.ERP_SSO_CLIENT_SECRET && env.IP_API_CLIENT_SECRET === env.ERP_SSO_CLIENT_SECRET)
    )
  ) {
    issues.push({
      code: 'IP_CREDENTIAL_REUSES_SSO',
      message: 'IP 业务 API 的 Client ID 和 Client Secret 均不得复用 SSO Code 兑换凭证'
    });
  }
  const effectiveIpMode = String(env.IP_AUTH_MODE || 'client_credentials').trim().toLowerCase();
  if (!['client_credentials', 'hybrid'].includes(effectiveIpMode)) {
    issues.push({
      code: 'IP_AUTH_MODE_INVALID',
      message: '生产统一认证预检要求 IP_AUTH_MODE=client_credentials，灰度期可使用 hybrid'
    });
  } else if (effectiveIpMode === 'hybrid') {
    if (!enablePassword && !enableLegacySession) {
      issues.push({
        code: 'IP_HYBRID_WITHOUT_LEGACY',
        message: '密码登录和 legacy session 均关闭后必须切换 IP_AUTH_MODE=client_credentials'
      });
    } else {
      warnings.push('IP_AUTH_MODE=hybrid 仅用于 SSO 灰度期；旧会话排空后必须切换 client_credentials');
    }
  }
  if (['client_credentials', 'hybrid'].includes(effectiveIpMode)) {
    validateRequiredUrl(env, 'IP_API_BASE_URL', issues, {
      rejectPlaceholderHost: true
    });
  }

  const activeKid = env.ERP_SSO_ACTIVE_KID || '';
  if (!activeKid) issues.push({ code: 'ACTIVE_KID_MISSING', message: '必须显式配置 ERP_SSO_ACTIVE_KID' });
  const activePublicKey = readPublicKey(
    env,
    'ERP_SSO_ACTIVE_PUBLIC_KEY',
    'ERP_SSO_ACTIVE_PUBLIC_KEY_PATH',
    cwd,
    issues,
    'active 公钥'
  );
  validateRsaPublicKey(activePublicKey, 'active 公钥', issues);

  const previousKid = env.ERP_SSO_PREVIOUS_KID || '';
  const previousKeyConfigured = Boolean(
    env.ERP_SSO_PREVIOUS_PUBLIC_KEY || env.ERP_SSO_PREVIOUS_PUBLIC_KEY_PATH
  );
  if (Boolean(previousKid) !== previousKeyConfigured) {
    issues.push({
      code: 'PREVIOUS_KEY_PAIR_INCOMPLETE',
      message: 'previous kid 与 previous 公钥必须同时配置或同时留空'
    });
  }
  let previousPublicKey = '';
  if (previousKid && previousKeyConfigured) {
    previousPublicKey = readPublicKey(
      env,
      'ERP_SSO_PREVIOUS_PUBLIC_KEY',
      'ERP_SSO_PREVIOUS_PUBLIC_KEY_PATH',
      cwd,
      issues,
      'previous 公钥'
    );
    validateRsaPublicKey(previousPublicKey, 'previous 公钥', issues);
    if (previousKid === activeKid) {
      issues.push({ code: 'KID_REUSED', message: 'active kid 与 previous kid 不能相同' });
    }
    if (previousPublicKey && previousPublicKey === activePublicKey) {
      issues.push({ code: 'PUBLIC_KEY_REUSED', message: 'active 与 previous 必须使用不同公钥' });
    }
  }
  if (readBoolean(env.ERP_SSO_ALLOW_LEGACY_NO_KID, false)) {
    issues.push({ code: 'LEGACY_NO_KID_ENABLED', message: '生产环境不得启用 ERP_SSO_ALLOW_LEGACY_NO_KID' });
  }

  const manifestSummary = validateManifest(manifest, issues);

  if (issues.length > 0) {
    throw buildPreflightError(issues);
  }

  if (configOnly) {
    return {
      ok: true,
      configOnly: true,
      featureFlags: {
        ssoLogin: enableSso,
        passwordLogin: enablePassword,
        legacySession: enableLegacySession
      },
      manifest: manifestSummary,
      redisChecked: false,
      employeeIndexChecked: false,
      databaseSchemaChecked: false,
      payrollSchemaChecked: false,
      warnings
    };
  }

  try {
    await redisCheck(env);
  } catch (_error) {
    issues.push({
      code: 'REDIS_UNAVAILABLE',
      message: '统一认证依赖的 Redis 连接或 PING 检查失败'
    });
    throw buildPreflightError(issues);
  }

  const checkEmployeeIndex = readBoolean(env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB, false);
  if (checkEmployeeIndex) {
    const runDatabaseChecks = async (database) => {
      try {
        await employeeIndexCheck(database);
      } catch (_error) {
        issues.push({
          code: 'ERP_DATABASE_INDEX_SCHEMA_INVALID',
          message: 'ERP 数据库业务索引未满足统一认证生产预检要求'
        });
        throw buildPreflightError(issues);
      }

      try {
        await payrollSchemaCheck(database);
      } catch (error) {
        issues.push(payrollSchemaIssue(error));
        throw buildPreflightError(issues);
      }
    };

    // 默认检查器需要数据库实例，因此在同一连接内依次完成全部只读检查，
    // 避免关闭 Sequelize singleton 后再次复用。测试/调用方若同时注入两个
    // 自包含检查器，则无需建立真实数据库连接。
    const usesDefaultDatabaseConnection =
      employeeIndexCheck === defaultEmployeeIndexCheck ||
      payrollSchemaCheck === defaultPayrollSchemaCheck;
    if (usesDefaultDatabaseConnection) {
      try {
        await withDefaultDatabaseConnection(runDatabaseChecks);
      } catch (error) {
        if (error?.code === 'UNIFIED_AUTH_PREFLIGHT_FAILED') throw error;
        issues.push({
          code: 'ERP_DATABASE_UNAVAILABLE',
          message: 'ERP 数据库连接或关闭检查失败'
        });
        throw buildPreflightError(issues);
      }
    } else {
      await runDatabaseChecks(undefined);
    }
  } else {
    warnings.push('未连接数据库；如需检查业务唯一约束和薪酬结构，请显式设置 UNIFIED_AUTH_PREFLIGHT_CHECK_DB=true');
  }

  return {
    ok: true,
    featureFlags: {
      ssoLogin: enableSso,
      passwordLogin: enablePassword,
      legacySession: enableLegacySession
    },
    manifest: manifestSummary,
    redisChecked: true,
    employeeIndexChecked: checkEmployeeIndex,
    databaseSchemaChecked: checkEmployeeIndex,
    payrollSchemaChecked: checkEmployeeIndex,
    warnings
  };
}

/**
 * 生产进程启动门禁：只校验本地运行配置和随应用发布的 Manifest。
 * 不连接数据库、Redis，也不调用主项目远程接口；外部依赖由启动连接和
 * readiness 分别检查，避免把部署 smoke 变成每次进程启动的远程耦合。
 */
async function assertProductionRuntimeConfig({
  env = process.env,
  manifest = defaultManifest,
  cwd = process.cwd()
} = {}) {
  if (env.NODE_ENV !== 'production') {
    return {
      ok: true,
      skipped: true,
      reason: 'non-production'
    };
  }

  try {
    return await runUnifiedAuthPreflight({
      env,
      manifest,
      cwd,
      configOnly: true
    });
  } catch (error) {
    if (error?.code === 'UNIFIED_AUTH_PREFLIGHT_FAILED') {
      error.code = 'PRODUCTION_RUNTIME_CONFIG_INVALID';
      error.message = `生产运行配置校验失败，共 ${error.issues?.length || 0} 项`;
    }
    throw error;
  }
}

module.exports = {
  readBoolean,
  validateBooleanSetting,
  validateEnumSetting,
  isPlaceholderValue,
  isPlaceholderHostname,
  validateSecret,
  readPublicKey,
  validateRsaPublicKey,
  validateRequiredUrl,
  validatePath,
  validateManifest,
  validateFixedSetting,
  defaultRedisCheck,
  defaultEmployeeIndexCheck,
  defaultPayrollSchemaCheck,
  withDefaultDatabaseConnection,
  payrollSchemaIssue,
  assertProductionRuntimeConfig,
  runUnifiedAuthPreflight
};
