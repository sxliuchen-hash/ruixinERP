const { ForbiddenError } = require('../utils/errors');
const { Op } = require('sequelize');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { getPermissionGrant } = require('../permissions/permissionGrant');
const { requirePermission } = require('./requirePermission');
const { attachPermissionDataScope, DENY_MATCH_VALUE } = require('../permissions/dataScope');
const { LEGACY_ERP_ROLES } = require('../permissions/legacyRoleAdapter');

// 仅供 legacy 密码会话兼容；main_sso 不根据角色名决定 ERP 访问权。
const ERP_ROLES = LEGACY_ERP_ROLES;

/**
 * legacy 角色权限兼容中间件。
 * main_sso 只能复用前置 Manifest 权限校验产生的 grant，不能凭角色名放行。
 * 新业务路由不得继续使用该中间件。
 * @param  {...string} roles - 允许的角色列表
 * @returns {Function} Express 中间件
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user?.authSource === 'main_sso') {
      if (req.permissionCode && req.permissionGrant?.allowed === true) return next();
      return next(new ForbiddenError('SSO 会话必须通过 Manifest 权限校验'));
    }
    if (!req.user || !req.user.role) {
      return next(new ForbiddenError('无法获取用户角色信息'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`需要以下角色之一: ${roles.join(', ')}`));
    }

    next();
  };
}

/**
 * ERP 入口权限兼容别名，实际统一校验 erp.app.view。
 * @returns {Function} Express 中间件
 */
function requireErpAccess() {
  return requirePermission(PERMISSIONS.APP_VIEW);
}

/**
 * legacy 管理员兼容中间件。
 * main_sso 必须已经通过前置 Manifest 权限校验，不能凭 admin 角色名放行。
 * @returns {Function} Express 中间件
 */
function requireAdmin() {
  return (req, res, next) => {
    if (req.user?.authSource === 'main_sso') {
      if (req.permissionCode && req.permissionGrant?.allowed === true) return next();
      return next(new ForbiddenError('SSO 会话必须通过 Manifest 权限校验'));
    }
    if (!req.user || !req.user.role) {
      return next(new ForbiddenError('无法获取用户角色信息'));
    }

    if (req.user.role !== 'admin') {
      return next(new ForbiddenError('仅管理员可执行此操作'));
    }

    next();
  };
}

/**
 * 数据隔离过滤器。
 * 指定 permissionCode 时严格执行 Manifest grant 的 self/team/all scope；
 * 未指定 permissionCode 时只为 legacy 会话保留 admin/process/agent 兼容逻辑，
 * main_sso 一律 fail-closed。
 *
 * 用法：
 *   const filter = dataFilter(req);
 *   // filter 返回一个 Sequelize where 条件对象
 *   const records = await Model.findAll({ where: { ...otherConditions, ...filter } });
 *
 * @param {Object} req - Express 请求对象（需包含 req.user）
 * @param {Object} [options] - 配置选项
 * @param {string} [options.ownerField='owner_id'] - 所有者字段名
 * @returns {Object} Sequelize where 条件对象，agent 返回 { [ownerField]: user.id }，其他返回 {}
 */
function dataFilter(req, options = {}) {
  const { ownerField = 'owner_id', permissionCode, teamUserIds } = options;

  if (permissionCode) {
    const grant = getPermissionGrant(req.user, permissionCode);
    if (!grant.allowed) return { [ownerField]: DENY_MATCH_VALUE };
    if (grant.scope === 'all') return {};
    if (grant.scope === 'self') return { [ownerField]: req.user.id };
    if (grant.scope === 'team' && Array.isArray(teamUserIds) && teamUserIds.length > 0) {
      return { [ownerField]: { [Op.in]: teamUserIds } };
    }
    return { [ownerField]: DENY_MATCH_VALUE };
  }

  // SSO 会话必须显式指定业务权限，不能退化为基于角色的范围判断。
  if (req.user?.authSource === 'main_sso') {
    return { [ownerField]: DENY_MATCH_VALUE };
  }

  // admin 和 process 可以看到所有数据
  if (!req.user) {
    return { [ownerField]: DENY_MATCH_VALUE };
  }

  if (req.user.role === 'admin' || req.user.role === 'process') {
    return {};
  }

  // agent 只能看到自己的数据
  if (req.user.role === 'agent') {
    return { [ownerField]: req.user.id };
  }

  // legacy 未知角色显式拒绝，不能退化为全量数据。
  return { [ownerField]: -1 };
}

/**
 * 数据隔离中间件（作为 Express 中间件使用）
 * 将数据过滤条件附加到 req.dataFilter 上，供 controller/service 使用
 *
 * 用法：
 *   router.get('/contracts', authenticate,
 *     requirePermission(PERMISSIONS.CONTRACT_VIEW),
 *     attachDataFilter({ permissionCode: PERMISSIONS.CONTRACT_VIEW }),
 *     contractController.list);
 *   // 在 controller 中：const filter = req.dataFilter;
 *
 * @param {Object} [options] - 配置选项
 * @param {string} [options.ownerField='owner_id'] - 所有者字段名
 * @returns {Function} Express 中间件
 */
function attachDataFilter(options = {}) {
  if (options.permissionCode) {
    const { permissionCode, ...scopeOptions } = options;
    return attachPermissionDataScope(permissionCode, scopeOptions);
  }

  return (req, res, next) => {
    req.dataFilter = dataFilter(req, options);
    next();
  };
}

module.exports = {
  requireRole,
  requireErpAccess,
  requireAdmin,
  dataFilter,
  attachDataFilter,
  ERP_ROLES
};
