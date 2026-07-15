const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { buildLegacyPermissions } = require('../permissions/legacyRoleAdapter');
const { isLegacySessionEnabled } = require('../config/authFeatures');
const mainPermissionVersionService = require('../services/mainPermissionVersionService');
const {
  normalizePermissions,
  decodePermissionGrants,
  getPermissionGrant
} = require('../permissions/permissionGrant');

function audienceContains(audience, expected) {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function resolveVerificationSecret(isMainSsoSession) {
  if (!isMainSsoSession) {
    if (!isLegacySessionEnabled() || !process.env.JWT_SECRET) {
      throw new UnauthorizedError('旧版 ERP 会话已失效，请从主项目重新进入');
    }
    return process.env.JWT_SECRET;
  }
  if (process.env.ERP_SESSION_SECRET) return process.env.ERP_SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new UnauthorizedError('ERP 单点登录会话配置无效');
  }
  return process.env.JWT_SECRET;
}

function resolveAuthSource(rawAuthSource) {
  if (rawAuthSource === 'main_sso') return 'main_sso';
  // 历史 JWT 没有 authSource，灰度期按 legacy 兼容；显式未知值一律拒绝。
  if (rawAuthSource === undefined || rawAuthSource === null || rawAuthSource === '' || rawAuthSource === 'legacy') {
    return 'legacy';
  }
  throw new UnauthorizedError('认证来源无效');
}

function validateMainSsoSessionClaims(decoded) {
  if (decoded.authSource !== 'main_sso') return true;

  const id = Number(decoded.id);
  if (
    typeof decoded.sub !== 'string' ||
    !/^[1-9]\d*$/.test(decoded.sub) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    Number(decoded.sub) !== id ||
    !Number.isInteger(decoded.iat) ||
    !Number.isInteger(decoded.exp) ||
    decoded.exp <= decoded.iat ||
    typeof decoded.jti !== 'string' ||
    decoded.jti.length < 8 ||
    decoded.jti.length > 200 ||
    typeof decoded.assertionJti !== 'string' ||
    decoded.assertionJti.length < 8 ||
    decoded.assertionJti.length > 200 ||
    !Number.isSafeInteger(decoded.permissionVersion) ||
    decoded.permissionVersion < 0
  ) {
    throw new UnauthorizedError('单点登录会话数据不完整');
  }
  return true;
}

function buildAuthenticatedUser(decoded) {
  const authSource = resolveAuthSource(decoded.authSource);
  const id = Number(decoded.id || decoded.sub);

  if (!Number.isInteger(id) || id <= 0 || !decoded.username || !decoded.role) {
    throw new UnauthorizedError('认证令牌数据不完整');
  }

  let permissions;
  let permissionVersion = 0;

  if (authSource === 'main_sso') {
    if (decoded.iss !== 'erp' || !audienceContains(decoded.aud, 'erp')) {
      throw new UnauthorizedError('单点登录会话签发方或接收方无效');
    }

    permissions = Object.keys(decoded.permissions || {}).length > 0
      ? normalizePermissions(decoded.permissions)
      : decodePermissionGrants(decoded.permissionGrants);

    permissionVersion = Number(decoded.permissionVersion);
    if (!Number.isInteger(permissionVersion) || permissionVersion < 0) {
      throw new UnauthorizedError('单点登录会话权限版本无效');
    }
  } else {
    if (!isLegacySessionEnabled()) {
      throw new UnauthorizedError('旧版 ERP 会话已失效，请从主项目重新进入');
    }
    permissions = buildLegacyPermissions(decoded.role);
  }

  if (!getPermissionGrant({ permissions }, PERMISSIONS.APP_VIEW).allowed) {
    throw new ForbiddenError('您的账号无权访问 ERP 系统');
  }

  return {
    id,
    username: decoded.username,
    role: decoded.role,
    realName: decoded.realName || '',
    email: decoded.email || '',
    phone: decoded.phone || '',
    departmentName: decoded.departmentName || '',
    permissions,
    permissionVersion,
    authSource
  };
}

/**
 * JWT 认证中间件
 * 从 Authorization header 提取 Bearer token，验证后将用户信息附加到 req.user
 * 同时校验角色是否允许访问 ERP 系统
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('未提供认证令牌');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('认证令牌格式错误');
    }

    // 只用未验签 payload 选择密钥，身份与权限仍以随后 verify 的结果为准。
    // SSO 会话优先使用独立 ERP_SESSION_SECRET，避免与旧密码登录共享密钥。
    const untrustedPayload = jwt.decode(token);
    const isMainSsoSession = untrustedPayload?.authSource === 'main_sso';
    const secret = resolveVerificationSecret(isMainSsoSession);
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    validateMainSsoSessionClaims(decoded);

    const user = buildAuthenticatedUser(decoded);
    if (user.authSource === 'main_sso') {
      mainPermissionVersionService.assertCurrentPermissionVersion(user)
        .then(() => {
          req.user = user;
          next();
        })
        .catch(next);
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('认证令牌已过期，请重新登录'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('认证令牌无效'));
    }
    // Pass through AppError instances (UnauthorizedError, ForbiddenError)
    next(error);
  }
}

module.exports = {
  authenticate,
  buildAuthenticatedUser,
  audienceContains,
  resolveVerificationSecret,
  resolveAuthSource,
  validateMainSsoSessionClaims
};
