'use strict';

const axios = require('axios');
const { AppError } = require('../utils/errors');
const { getMainSsoConfig } = require('../config/mainSso');
const { MainSsoService } = require('./mainSsoService');

const USER_ID_ENV = 'MAIN_CONTRACT_SMOKE_USER_ID';
const AUTHORIZATION_CODE_ENV = 'SSO_AUTHORIZATION_CODE';
const SSO_STATE_ENV = 'SSO_STATE';

function smokeError(message, code, statusCode = 503) {
  return new AppError(message, statusCode, code);
}

function unwrapPayload(response, label) {
  const body = response?.data;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw smokeError(
      `${label}响应必须是 JSON 对象`,
      'MAIN_CONTRACT_SMOKE_RESPONSE_INVALID'
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, 'success')) {
    if (body.success !== true || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw smokeError(
        `${label}响应 success/data 结构无效`,
        'MAIN_CONTRACT_SMOKE_RESPONSE_INVALID'
      );
    }
    return body.data;
  }

  // 主项目统一响应格式为 { code: 200, message, data }。
  if (Object.prototype.hasOwnProperty.call(body, 'code')) {
    const responseCode = Number(body.code);
    if (
      !Number.isInteger(responseCode) ||
      responseCode < 200 ||
      responseCode >= 300 ||
      !body.data ||
      typeof body.data !== 'object' ||
      Array.isArray(body.data)
    ) {
      throw smokeError(
        `${label}响应 code/data 结构无效`,
        'MAIN_CONTRACT_SMOKE_RESPONSE_INVALID'
      );
    }
    return body.data;
  }

  return body;
}

function readTargetUserId(env) {
  const userId = Number(env[USER_ID_ENV]);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw smokeError(
      `${USER_ID_ENV} 必须是正整数`,
      'MAIN_CONTRACT_SMOKE_USER_ID_INVALID',
      400
    );
  }
  return userId;
}

function validateBaseConfig(config) {
  try {
    const baseUrl = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('unsupported protocol');
  } catch (_error) {
    throw smokeError(
      'MAIN_SSO_BASE_URL 必须是有效的 HTTP/HTTPS 地址',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }

  if (!config.businessClientId || !config.businessClientSecret) {
    throw smokeError(
      '主项目业务 API 凭证未配置',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  if (
    (config.clientId && config.businessClientId === config.clientId) ||
    (config.clientSecret && config.businessClientSecret === config.clientSecret)
  ) {
    throw smokeError(
      '主项目业务 API 的 Client ID 和 Client Secret 均不得复用 SSO 兑换凭证',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  if (!config.teamScopePath || !config.teamScopePath.includes(':userId')) {
    throw smokeError(
      'MAIN_SSO_TEAM_SCOPE_PATH 必须包含 :userId',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  if (!config.permissionVersionPath || !config.permissionVersionPath.includes(':userId')) {
    throw smokeError(
      'MAIN_PERMISSION_VERSION_PATH 必须包含 :userId',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
}

function validateSsoConfig(config) {
  if (!config.clientId || !config.clientSecret) {
    throw smokeError(
      '提供一次性 Code 时必须配置 ERP_SSO_CLIENT_ID/SECRET',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  if (!config.callbackUrl || !config.exchangePath) {
    throw smokeError(
      '提供一次性 Code 时必须配置 SSO exchange 路径和 ERP callback',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  if (!config.publicKeys || Object.keys(config.publicKeys).length === 0) {
    throw smokeError(
      '提供一次性 Code 时必须配置主项目 RS256 验签公钥',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
}

async function requestOrThrow(request, label) {
  try {
    return await request();
  } catch (error) {
    if (error?.code?.startsWith('MAIN_CONTRACT_SMOKE_')) throw error;
    const status = Number(error?.response?.status);
    const statusText = Number.isInteger(status) && status > 0 ? `（HTTP ${status}）` : '';
    throw smokeError(
      `${label}请求失败${statusText}`,
      'MAIN_CONTRACT_SMOKE_HTTP_ERROR'
    );
  }
}

function validateTeamUserIds(payload, targetUserId) {
  if (!Array.isArray(payload.teamUserIds)) {
    throw smokeError(
      'team-scope 响应缺少 teamUserIds 数组',
      'MAIN_CONTRACT_SMOKE_TEAM_SCOPE_INVALID'
    );
  }

  const teamUserIds = payload.teamUserIds;
  if (teamUserIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw smokeError(
      'teamUserIds 只能包含正整数用户 ID',
      'MAIN_CONTRACT_SMOKE_TEAM_SCOPE_INVALID'
    );
  }
  if (new Set(teamUserIds).size !== teamUserIds.length) {
    throw smokeError(
      'teamUserIds 不得包含重复用户 ID',
      'MAIN_CONTRACT_SMOKE_TEAM_SCOPE_INVALID'
    );
  }
  if (!teamUserIds.includes(targetUserId)) {
    throw smokeError(
      'teamUserIds 必须包含被检查用户本人',
      'MAIN_CONTRACT_SMOKE_TEAM_SCOPE_INVALID'
    );
  }
  return teamUserIds;
}

function validatePermissionVersion(payload) {
  if (payload.permissionVersion === undefined || payload.permissionVersion === null) {
    throw smokeError(
      'permission-version 响应缺少 permissionVersion',
      'MAIN_CONTRACT_SMOKE_PERMISSION_VERSION_INVALID'
    );
  }
  const permissionVersion = payload.permissionVersion;
  if (!Number.isSafeInteger(permissionVersion) || permissionVersion < 0) {
    throw smokeError(
      'permissionVersion 必须是非负整数',
      'MAIN_CONTRACT_SMOKE_PERMISSION_VERSION_INVALID'
    );
  }
  return permissionVersion;
}

async function runMainProjectContractSmoke({
  env = process.env,
  config,
  httpClient = axios,
  assertionVerifier
} = {}) {
  const targetUserId = readTargetUserId(env);
  const authorizationCode = String(env[AUTHORIZATION_CODE_ENV] || '').trim();
  const ssoState = String(env[SSO_STATE_ENV] || '').trim();
  if (Boolean(authorizationCode) !== Boolean(ssoState)) {
    throw smokeError(
      `${AUTHORIZATION_CODE_ENV} 与 ${SSO_STATE_ENV} 必须同时配置或同时留空`,
      'MAIN_CONTRACT_SMOKE_SSO_STATE_REQUIRED',
      400
    );
  }
  if (ssoState && !/^[A-Za-z0-9_-]{32,200}$/.test(ssoState)) {
    throw smokeError(
      `${SSO_STATE_ENV} 格式无效`,
      'MAIN_CONTRACT_SMOKE_SSO_STATE_INVALID',
      400
    );
  }
  if (!config && !String(env.MAIN_SSO_BASE_URL || '').trim()) {
    throw smokeError(
      '契约烟雾检查必须显式配置 MAIN_SSO_BASE_URL',
      'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR'
    );
  }
  const effectiveConfig = config || getMainSsoConfig({ includePublicKey: Boolean(authorizationCode) });
  validateBaseConfig(effectiveConfig);

  const businessHeaders = {
    [effectiveConfig.businessClientIdHeader]: effectiveConfig.businessClientId,
    [effectiveConfig.businessClientSecretHeader]: effectiveConfig.businessClientSecret
  };
  const encodedUserId = encodeURIComponent(targetUserId);
  const teamScopePath = effectiveConfig.teamScopePath.replace(':userId', encodedUserId);
  const permissionVersionPath = effectiveConfig.permissionVersionPath.replace(':userId', encodedUserId);

  const [teamResponse, permissionVersionResponse] = await Promise.all([
    requestOrThrow(
      () => httpClient.get(`${effectiveConfig.baseUrl}${teamScopePath}`, {
        timeout: effectiveConfig.timeoutMs,
        headers: businessHeaders
      }),
      'team-scope'
    ),
    requestOrThrow(
      () => httpClient.get(`${effectiveConfig.baseUrl}${permissionVersionPath}`, {
        timeout: effectiveConfig.timeoutMs,
        headers: businessHeaders
      }),
      'permission-version'
    )
  ]);

  const teamUserIds = validateTeamUserIds(unwrapPayload(teamResponse, 'team-scope'), targetUserId);
  const permissionVersion = validatePermissionVersion(
    unwrapPayload(permissionVersionResponse, 'permission-version')
  );

  let sso = null;
  if (authorizationCode) {
    validateSsoConfig(effectiveConfig);
    const exchangeResponse = await requestOrThrow(
      () => httpClient.post(
        `${effectiveConfig.baseUrl}${effectiveConfig.exchangePath}`,
        {
          authorizationCode,
          state: ssoState,
          audience: effectiveConfig.audience,
          redirectUri: effectiveConfig.callbackUrl
        },
        {
          timeout: effectiveConfig.timeoutMs,
          headers: {
            [effectiveConfig.clientIdHeader]: effectiveConfig.clientId,
            [effectiveConfig.clientSecretHeader]: effectiveConfig.clientSecret,
            'Content-Type': 'application/json'
          }
        }
      ),
      'SSO exchange'
    );
    const exchangePayload = unwrapPayload(exchangeResponse, 'SSO exchange');
    if (!exchangePayload.assertion || typeof exchangePayload.assertion !== 'string') {
      throw smokeError(
        'SSO exchange 响应缺少 assertion',
        'MAIN_CONTRACT_SMOKE_SSO_RESPONSE_INVALID'
      );
    }

    const verifyAssertion = assertionVerifier || ((assertion, verifyConfig) => (
      new MainSsoService({ httpClient }).verifyAssertion(assertion, verifyConfig)
    ));
    const assertionData = verifyAssertion(exchangePayload.assertion, effectiveConfig);
    if (assertionData.user.id !== targetUserId) {
      throw smokeError(
        'SSO assertion 用户 ID 与被检查用户不一致',
        'MAIN_CONTRACT_SMOKE_SSO_USER_MISMATCH'
      );
    }
    if (!Number.isInteger(assertionData.permissionVersion) || assertionData.permissionVersion < 0) {
      throw smokeError(
        'SSO assertion permissionVersion 无效',
        'MAIN_CONTRACT_SMOKE_SSO_RESPONSE_INVALID'
      );
    }
    if (assertionData.permissionVersion !== permissionVersion) {
      throw smokeError(
        'SSO assertion permissionVersion 与实时查询结果不一致',
        'MAIN_CONTRACT_SMOKE_SSO_PERMISSION_VERSION_MISMATCH'
      );
    }
    sso = {
      verified: true,
      userId: assertionData.user.id,
      permissionVersion: assertionData.permissionVersion
    };
  }

  return {
    userId: targetUserId,
    teamUserIds,
    permissionVersion,
    sso
  };
}

module.exports = {
  USER_ID_ENV,
  AUTHORIZATION_CODE_ENV,
  SSO_STATE_ENV,
  unwrapPayload,
  validateTeamUserIds,
  validatePermissionVersion,
  runMainProjectContractSmoke
};
