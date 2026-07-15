'use strict';

const jwt = require('jsonwebtoken');
const { AppError, UnauthorizedError } = require('../utils/errors');
const { isLegacySessionEnabled } = require('../config/authFeatures');

const AUTH_MODES = Object.freeze({
  LEGACY_SHARED_JWT: 'legacy_shared_jwt',
  CLIENT_CREDENTIALS: 'client_credentials',
  HYBRID: 'hybrid'
});

const FORBIDDEN_IDENTITY_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'connection',
  'content-type',
  'content-length',
  'transfer-encoding'
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

class IpApiAuthService {
  getAuthMode() {
    const defaultMode = process.env.NODE_ENV === 'production'
      ? AUTH_MODES.CLIENT_CREDENTIALS
      : AUTH_MODES.LEGACY_SHARED_JWT;
    const mode = String(process.env.IP_AUTH_MODE || defaultMode)
      .trim()
      .toLowerCase();
    if (!Object.values(AUTH_MODES).includes(mode)) {
      throw new AppError('IP 系统认证模式配置无效', 503, 'IP_AUTH_CONFIGURATION_ERROR');
    }
    if (
      [AUTH_MODES.LEGACY_SHARED_JWT, AUTH_MODES.HYBRID].includes(mode) &&
      !isLegacySessionEnabled()
    ) {
      throw new AppError(
        'legacy 会话已关闭，IP 系统认证必须使用 client_credentials',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }
    return mode;
  }

  getClientCredentials() {
    const ipClientId = process.env.IP_API_CLIENT_ID || '';
    const ipClientSecret = process.env.IP_API_CLIENT_SECRET || '';
    const hasIpClientId = Boolean(ipClientId);
    const hasIpClientSecret = Boolean(ipClientSecret);

    if (hasIpClientId !== hasIpClientSecret) {
      throw new AppError(
        'IP_API_CLIENT_ID 与 IP_API_CLIENT_SECRET 必须成对配置',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }

    // 只有 IP 专用凭证两项都未配置时，才整体复用 MAIN_API 凭证；
    // 禁止一半来自 IP_API、一半来自 MAIN_API 的混合凭证。
    const clientId = hasIpClientId ? ipClientId : (process.env.MAIN_API_CLIENT_ID || '');
    const clientSecret = hasIpClientSecret
      ? ipClientSecret
      : (process.env.MAIN_API_CLIENT_SECRET || '');

    if (!clientId || !clientSecret) {
      throw new AppError('IP 系统服务凭证未配置', 503, 'IP_AUTH_CONFIGURATION_ERROR');
    }
    if (
      (process.env.ERP_SSO_CLIENT_ID && clientId === process.env.ERP_SSO_CLIENT_ID) ||
      (process.env.ERP_SSO_CLIENT_SECRET && clientSecret === process.env.ERP_SSO_CLIENT_SECRET)
    ) {
      throw new AppError(
        'IP 系统业务 API 的 Client ID 和 Client Secret 均不得复用 SSO 兑换凭证',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }

    return { clientId, clientSecret };
  }

  getIdentityHeaderNames() {
    const names = {
      clientId: process.env.IP_API_CLIENT_ID_HEADER || 'X-ERP-Service-Id',
      clientSecret: process.env.IP_API_CLIENT_SECRET_HEADER || 'X-ERP-Service-Secret',
      actingUserId: process.env.IP_API_ACTING_USER_ID_HEADER || 'X-Acting-User-Id',
      permissionVersion: process.env.IP_API_PERMISSION_VERSION_HEADER || 'X-Acting-Permission-Version',
      jobName: process.env.IP_API_JOB_NAME_HEADER || 'X-ERP-Job-Name'
    };
    const normalized = Object.values(names).map((name) => String(name).trim().toLowerCase());

    if (
      Object.values(names).some((name) => !HEADER_NAME_PATTERN.test(String(name).trim())) ||
      normalized.some((name) => FORBIDDEN_IDENTITY_HEADERS.has(name)) ||
      new Set(normalized).size !== normalized.length
    ) {
      throw new AppError(
        'IP 系统身份 Header 配置无效或存在重名',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }

    return Object.fromEntries(
      Object.entries(names).map(([key, name]) => [key, String(name).trim()])
    );
  }

  buildClientCredentialHeaders(req, { jobName } = {}) {
    const { clientId, clientSecret } = this.getClientCredentials();
    const headerNames = this.getIdentityHeaderNames();
    const hasActingUser = req?.user !== undefined && req?.user !== null;
    const hasJob = jobName !== undefined && jobName !== null;
    if (hasActingUser && hasJob) {
      throw new AppError(
        'acting user 与后台任务身份不能同时提交',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }

    const headers = {
      [headerNames.clientId]: clientId,
      [headerNames.clientSecret]: clientSecret,
      'Content-Type': 'application/json'
    };

    if (hasActingUser) {
      const actingUserId = req.user.id;
      const actingPermissionVersion = req.user.permissionVersion;
      if (
        !Number.isSafeInteger(actingUserId) ||
        actingUserId <= 0 ||
        !Number.isSafeInteger(actingPermissionVersion) ||
        actingPermissionVersion < 0
      ) {
        throw new UnauthorizedError('操作用户身份或权限版本无效');
      }
      headers[headerNames.actingUserId] = String(actingUserId);
      headers[headerNames.permissionVersion] =
        String(actingPermissionVersion);
    } else if (hasJob) {
      const normalizedJobName = typeof jobName === 'string' ? jobName.trim() : '';
      if (!/^[a-z0-9][a-z0-9._:-]{0,99}$/.test(normalizedJobName)) {
        throw new AppError(
          'IP 系统后台任务名称无效',
          503,
          'IP_AUTH_CONFIGURATION_ERROR'
        );
      }
      headers[headerNames.jobName] = normalizedJobName;
    } else {
      throw new AppError(
        '缺少 acting user 或后台任务身份',
        503,
        'IP_AUTH_CONFIGURATION_ERROR'
      );
    }

    return headers;
  }

  extractLegacyAuthorization(req) {
    if (!isLegacySessionEnabled() || req?.user?.authSource !== 'legacy') {
      throw new UnauthorizedError('旧版 ERP 会话已失效，请从主项目重新进入');
    }
    const authorization = req?.headers?.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedError('无法获取 ERP 认证令牌');
    }
    return authorization;
  }

  generateLegacySystemAuthorization() {
    if (!isLegacySessionEnabled() || !process.env.JWT_SECRET) {
      throw new AppError('旧版共享 JWT 密钥未配置', 503, 'IP_AUTH_CONFIGURATION_ERROR');
    }
    const token = jwt.sign(
      {
        id: Number.parseInt(process.env.IP_SYSTEM_USER_ID, 10) || 1,
        username: 'system',
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    return `Bearer ${token}`;
  }

  buildUserRequestHeaders(req) {
    const mode = this.getAuthMode();
    const useClientCredentials = mode === AUTH_MODES.CLIENT_CREDENTIALS || (
      mode === AUTH_MODES.HYBRID && req?.user?.authSource === 'main_sso'
    );
    if (useClientCredentials) {
      if (!req?.user?.id || req.user.authSource !== 'main_sso') {
        throw new UnauthorizedError('缺少有效的主项目 SSO 操作用户');
      }
      return this.buildClientCredentialHeaders(req);
    }
    if (mode === AUTH_MODES.HYBRID && req?.user?.authSource !== 'legacy') {
      throw new UnauthorizedError('无法确定 ERP 会话认证来源');
    }
    return {
      Authorization: this.extractLegacyAuthorization(req),
      'Content-Type': 'application/json'
    };
  }

  buildBackgroundRequestHeaders(jobName) {
    const mode = this.getAuthMode();
    if (mode === AUTH_MODES.CLIENT_CREDENTIALS || mode === AUTH_MODES.HYBRID) {
      return this.buildClientCredentialHeaders(null, { jobName });
    }
    return {
      Authorization: this.generateLegacySystemAuthorization(),
      'Content-Type': 'application/json'
    };
  }
}

module.exports = new IpApiAuthService();
module.exports.IpApiAuthService = IpApiAuthService;
module.exports.AUTH_MODES = AUTH_MODES;
