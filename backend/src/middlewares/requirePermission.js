'use strict';

const { ForbiddenError } = require('../utils/errors');
const { isKnownPermission } = require('../permissions/permissionCodes');
const { getPermissionGrant } = require('../permissions/permissionGrant');

function hasPermission(user, permissionCode) {
  return getPermissionGrant(user, permissionCode).allowed === true;
}

function requirePermission(permissionCode) {
  if (!isKnownPermission(permissionCode)) {
    throw new Error(`未注册的 ERP 权限编码: ${permissionCode}`);
  }

  return (req, res, next) => {
    const grant = getPermissionGrant(req.user, permissionCode);
    if (!grant.allowed) {
      return next(new ForbiddenError('无权执行此操作'));
    }

    req.permissionGrant = grant;
    req.permissionCode = permissionCode;
    next();
  };
}

module.exports = {
  requirePermission,
  hasPermission,
  getPermissionGrant
};
