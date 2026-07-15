'use strict';

const { Op } = require('sequelize');
const { getPermissionGrant } = require('./permissionGrant');

const DENY_MATCH_VALUE = -1;
const SCOPE_RANK = Object.freeze({ self: 0, team: 1, all: 2 });

function getCombinedPermissionGrant(user, permissionCodes) {
  if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
    return { allowed: false, scope: 'none' };
  }

  const grants = permissionCodes.map((permissionCode) => getPermissionGrant(user, permissionCode));
  if (grants.some((grant) => !grant.allowed || SCOPE_RANK[grant.scope] === undefined)) {
    return { allowed: false, scope: 'none' };
  }

  return grants.reduce((narrowest, grant) => (
    SCOPE_RANK[grant.scope] < SCOPE_RANK[narrowest.scope] ? grant : narrowest
  ));
}

async function buildFilterForGrant({
  user,
  grant,
  ownerField = 'owner_id',
  ownerFields,
  teamUserIds,
  resolveTeamUserIds
}) {
  const fields = Array.isArray(ownerFields) && ownerFields.length > 0
    ? [...new Set(ownerFields.filter((field) => typeof field === 'string' && field))]
    : [ownerField];
  const denyFilter = { [fields[0] || ownerField]: DENY_MATCH_VALUE };
  const buildOwnerFilter = (value) => fields.length === 1
    ? { [fields[0]]: value }
    : { [Op.or]: fields.map((field) => ({ [field]: value })) };

  if (!grant.allowed) return denyFilter;
  if (grant.scope === 'all') return {};
  if (grant.scope === 'self') return buildOwnerFilter(user.id);

  if (grant.scope === 'team') {
    let resolvedIds = teamUserIds;
    if (!Array.isArray(resolvedIds) && typeof resolveTeamUserIds === 'function') {
      resolvedIds = await resolveTeamUserIds(user.id);
    }

    if (!Array.isArray(resolvedIds) || resolvedIds.length === 0) {
      return denyFilter;
    }

    const normalizedIds = [...new Set(resolvedIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0))];

    if (!normalizedIds.includes(Number(user.id))) {
      normalizedIds.push(Number(user.id));
    }

    if (normalizedIds.length === 0) return denyFilter;
    return buildOwnerFilter({ [Op.in]: normalizedIds });
  }

  return denyFilter;
}

/**
 * 根据权限 grant 生成 Sequelize where 片段。
 * team 范围必须显式提供 teamUserIds 或 resolveTeamUserIds；未提供时拒绝匹配，
 * 避免团队服务不可用时意外退化为全部数据。
 */
async function buildDataScopeFilter({
  user,
  permissionCode,
  ownerField = 'owner_id',
  ownerFields,
  teamUserIds,
  resolveTeamUserIds
}) {
  const grant = getPermissionGrant(user, permissionCode);
  return buildFilterForGrant({
    user,
    grant,
    ownerField,
    ownerFields,
    teamUserIds,
    resolveTeamUserIds
  });
}

async function buildCombinedDataScopeFilter({
  user,
  permissionCodes,
  ownerField = 'owner_id',
  ownerFields,
  teamUserIds,
  resolveTeamUserIds
}) {
  const grant = getCombinedPermissionGrant(user, permissionCodes);
  return buildFilterForGrant({
    user,
    grant,
    ownerField,
    ownerFields,
    teamUserIds,
    resolveTeamUserIds
  });
}

function attachPermissionDataScope(permissionCode, options = {}) {
  return async (req, res, next) => {
    try {
      const resolveTeamUserIds = options.resolveTeamUserIds ||
        ((userId) => require('../services/mainUserScopeService').getTeamUserIds(userId));
      req.dataFilter = await buildDataScopeFilter({
        user: req.user,
        permissionCode,
        ...options,
        resolveTeamUserIds
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

function attachCombinedPermissionDataScope(permissionCodes, options = {}) {
  return async (req, res, next) => {
    try {
      const resolveTeamUserIds = options.resolveTeamUserIds ||
        ((userId) => require('../services/mainUserScopeService').getTeamUserIds(userId));
      req.dataFilter = await buildCombinedDataScopeFilter({
        user: req.user,
        permissionCodes,
        ...options,
        resolveTeamUserIds
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  DENY_MATCH_VALUE,
  getCombinedPermissionGrant,
  buildDataScopeFilter,
  buildCombinedDataScopeFilter,
  attachPermissionDataScope,
  attachCombinedPermissionDataScope
};
