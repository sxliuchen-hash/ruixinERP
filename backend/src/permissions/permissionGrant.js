'use strict';

const { isKnownPermission } = require('./permissionCodes');
const permissionManifest = require('./erp-permission-manifest.json');

const VALID_SCOPES = Object.freeze(['self', 'team', 'all']);
const VALID_SCOPE_SET = new Set(VALID_SCOPES);
const SUPPORTED_SCOPES_BY_PERMISSION = new Map(
  permissionManifest.modules.flatMap((module) =>
    module.permissions.map((permission) => [permission.code, new Set(permission.scopes)])
  )
);
const DEPRECATED_PERMISSION_CODES = new Set(
  permissionManifest.modules.flatMap((module) =>
    module.permissions.filter((permission) => permission.deprecated).map((permission) => permission.code)
  )
);

function isValidScope(scope) {
  return VALID_SCOPE_SET.has(scope);
}

function normalizePermissionGrant(grant, permissionCode) {
  if (!grant || grant.allowed !== true || !isValidScope(grant.scope)) {
    return { allowed: false, scope: 'none' };
  }
  if (permissionCode && !SUPPORTED_SCOPES_BY_PERMISSION.get(permissionCode)?.has(grant.scope)) {
    return { allowed: false, scope: 'none' };
  }

  return {
    allowed: true,
    scope: grant.scope
  };
}

function normalizePermissions(permissions, { allowUnknown = false } = {}) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return {};
  }

  const normalized = {};
  for (const [permissionCode, grant] of Object.entries(permissions)) {
    if (!allowUnknown && !isKnownPermission(permissionCode)) continue;
    if (DEPRECATED_PERMISSION_CODES.has(permissionCode)) continue;

    const normalizedGrant = normalizePermissionGrant(grant, permissionCode);
    if (normalizedGrant.allowed) {
      normalized[permissionCode] = normalizedGrant;
    }
  }
  return normalized;
}

function getPermissionGrant(user, permissionCode) {
  if (!user || !permissionCode || DEPRECATED_PERMISSION_CODES.has(permissionCode)) {
    return { allowed: false, scope: 'none' };
  }

  return normalizePermissionGrant(user.permissions?.[permissionCode], permissionCode);
}

function encodePermissionGrants(permissions) {
  return Object.entries(normalizePermissions(permissions))
    .map(([permissionCode, grant]) => [permissionCode, grant.scope]);
}

function decodePermissionGrants(permissionGrants) {
  if (!Array.isArray(permissionGrants)) return {};

  const permissions = {};
  for (const item of permissionGrants) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [permissionCode, scope] = item;
    if (!isKnownPermission(permissionCode) || !isValidScope(scope)) continue;
    permissions[permissionCode] = { allowed: true, scope };
  }
  return permissions;
}

module.exports = {
  VALID_SCOPES,
  isValidScope,
  normalizePermissionGrant,
  normalizePermissions,
  getPermissionGrant,
  encodePermissionGrants,
  decodePermissionGrants
};
