'use strict';

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { AppError, UnauthorizedError, ForbiddenError, ValidationError } = require('../utils/errors');
const { isSsoLoginEnabled } = require('../config/authFeatures');
const { getMainSsoConfig, assertMainSsoConfig } = require('../config/mainSso');
const mainPermissionVersionService = require('./mainPermissionVersionService');
const mainUserScopeService = require('./mainUserScopeService');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const {
  normalizePermissions,
  getPermissionGrant,
  encodePermissionGrants
} = require('../permissions/permissionGrant');
const { createDefaultReplayGuard } = require('./ssoAssertionReplayGuard');
const { isValidOpaqueToken } = require('./ssoStateService');

const ALLOWED_MAIN_USER_ROLES = new Set(['admin', 'process', 'supervisor', 'agent']);

class MainSsoService {
  constructor({ httpClient = axios, assertionReplayGuard = createDefaultReplayGuard() } = {}) {
    this.httpClient = httpClient;
    this.assertionReplayGuard = assertionReplayGuard;
  }

  verifyAssertion(assertion, config = getMainSsoConfig()) {
    if (!assertion || typeof assertion !== 'string') {
      throw new UnauthorizedError('主项目未返回有效身份断言');
    }

    const decodedToken = jwt.decode(assertion, { complete: true });
    const header = decodedToken?.header || {};
    if (header.alg !== 'RS256') {
      throw new UnauthorizedError('主项目身份断言签名算法无效');
    }
    if (
      header.kid !== undefined &&
      (typeof header.kid !== 'string' || !header.kid || header.kid.length > 128)
    ) {
      throw new UnauthorizedError('主项目身份断言 kid 无效');
    }

    let publicKey;
    if (
      header.kid &&
      config.publicKeys &&
      Object.prototype.hasOwnProperty.call(config.publicKeys, header.kid)
    ) {
      publicKey = config.publicKeys[header.kid];
    } else if (!header.kid && config.allowLegacyNoKid) {
      const keys = Object.values(config.publicKeys || {});
      if (keys.length === 1) publicKey = keys[0];
    }

    if (!publicKey) {
      throw new UnauthorizedError('主项目身份断言 kid 缺失或未知');
    }

    let decoded;
    try {
      decoded = jwt.verify(assertion, publicKey, {
        algorithms: ['RS256'],
        audience: config.audience,
        issuer: config.issuer,
        clockTolerance: 5
      });
    } catch (_error) {
      throw new UnauthorizedError('主项目身份断言无效或已过期');
    }

    if (
      !Number.isInteger(decoded.exp) ||
      !Number.isInteger(decoded.iat) ||
      decoded.exp <= decoded.iat ||
      decoded.exp - decoded.iat > config.assertionMaxLifetimeSec ||
      decoded.iat > Math.floor(Date.now() / 1000) + 5 ||
      typeof decoded.jti !== 'string' ||
      decoded.jti.length < 8 ||
      decoded.jti.length > 200
    ) {
      throw new UnauthorizedError('主项目身份断言数据不完整');
    }

    const sourceUser = decoded.user && typeof decoded.user === 'object'
      ? decoded.user
      : decoded;
    if (typeof decoded.sub !== 'string' || !/^[1-9]\d*$/.test(decoded.sub)) {
      throw new UnauthorizedError('主项目身份断言用户标识无效');
    }
    const id = Number(decoded.sub);
    const username = sourceUser.username || decoded.username;
    const role = sourceUser.role || decoded.role;
    const permissions = normalizePermissions(decoded.permissions);

    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof username !== 'string' ||
      !username.trim() ||
      typeof role !== 'string' ||
      !ALLOWED_MAIN_USER_ROLES.has(role.trim())
    ) {
      throw new UnauthorizedError('主项目身份断言缺少用户信息');
    }
    if (
      sourceUser.id !== undefined &&
      (!Number.isSafeInteger(sourceUser.id) || sourceUser.id !== id)
    ) {
      throw new UnauthorizedError('主项目身份断言用户标识不一致');
    }

    if (!getPermissionGrant({ permissions }, PERMISSIONS.APP_VIEW).allowed) {
      throw new ForbiddenError('当前用户无权访问 ERP 系统');
    }

    if (decoded.permissionVersion === undefined || decoded.permissionVersion === null) {
      throw new UnauthorizedError('主项目身份断言缺少权限版本');
    }

    const permissionVersion = decoded.permissionVersion;
    if (!Number.isSafeInteger(permissionVersion) || permissionVersion < 0) {
      throw new UnauthorizedError('主项目身份断言权限版本无效');
    }

    return {
      assertionJti: decoded.jti,
      assertionExpiresAt: decoded.exp,
      user: {
        id,
        username: username.trim(),
        role: role.trim(),
        realName: sourceUser.realName || sourceUser.real_name || decoded.realName || '',
        email: sourceUser.email || '',
        phone: sourceUser.phone || '',
        departmentName: sourceUser.departmentName || sourceUser.department_name || ''
      },
      permissions,
      permissionVersion
    };
  }

  createErpSession(assertionData, config = getMainSsoConfig()) {
    const { user, permissions, permissionVersion, assertionJti } = assertionData;
    const token = jwt.sign({
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      departmentName: user.departmentName,
      authSource: 'main_sso',
      permissionVersion,
      permissionGrants: encodePermissionGrants(permissions),
      assertionJti
    }, config.sessionSecret, {
      expiresIn: config.sessionExpiresIn,
      issuer: 'erp',
      audience: 'erp',
      subject: String(user.id),
      jwtid: randomUUID()
    });

    return {
      token,
      user: {
        ...user,
        authSource: 'main_sso',
        permissionVersion
      },
      permissions,
      permissionVersion,
      authSource: 'main_sso'
    };
  }

  async exchangeCode(authorizationCode, state) {
    if (!isSsoLoginEnabled()) {
      throw new AppError('主项目单点登录尚未启用', 503, 'SSO_LOGIN_DISABLED');
    }

    const config = getMainSsoConfig();
    assertMainSsoConfig(config);
    if (!isValidOpaqueToken(state)) {
      throw new ValidationError('SSO 登录状态格式错误');
    }

    let response;
    try {
      response = await this.httpClient.post(
        `${config.baseUrl}${config.exchangePath}`,
        {
          authorizationCode,
          state,
          audience: config.audience,
          redirectUri: config.callbackUrl
        },
        {
          timeout: config.timeoutMs,
          headers: {
            [config.clientIdHeader]: config.clientId,
            [config.clientSecretHeader]: config.clientSecret,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      const status = error.response?.status;
      logger.warn('主项目 SSO 授权码兑换失败', {
        status: status || 0,
        code: error.code || 'HTTP_ERROR'
      });

      if (status === 403) {
        throw new ForbiddenError('当前用户无权访问 ERP 系统');
      }
      if (status === 400 || status === 401 || status === 404 || status === 409 || status === 410) {
        throw new UnauthorizedError('单点登录授权码无效、已过期或已使用');
      }
      if (status === 429) {
        throw new AppError('单点登录请求过于频繁，请稍后再试', 429, 'SSO_RATE_LIMIT');
      }
      throw new AppError('主项目认证服务暂时不可用', 503, 'MAIN_SSO_UNAVAILABLE');
    }

    const payload = response?.data?.data || response?.data || {};
    const assertionData = this.verifyAssertion(payload.assertion, config);
    await this.assertionReplayGuard.consume({
      jti: assertionData.assertionJti,
      expiresAt: assertionData.assertionExpiresAt
    });

    // 新 assertion 已携带主项目当前权限版本。清除旧会话留下的本地缓存，
    // 避免重新 SSO 后第一次请求仍命中旧 permissionVersion/teamUserIds。
    mainPermissionVersionService.clearCache(assertionData.user.id);
    mainUserScopeService.clearCache(assertionData.user.id);

    const result = this.createErpSession(assertionData, config);

    logger.info('主项目 SSO 登录成功', {
      userId: result.user.id,
      role: result.user.role,
      permissionVersion: result.permissionVersion
    });

    return result;
  }
}

module.exports = new MainSsoService();
module.exports.MainSsoService = MainSsoService;
module.exports.ALLOWED_MAIN_USER_ROLES = ALLOWED_MAIN_USER_ROLES;
