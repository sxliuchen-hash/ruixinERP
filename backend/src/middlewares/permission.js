const { ForbiddenError } = require('../utils/errors');

// 允许访问 ERP 的角色
const ERP_ROLES = ['admin', 'process', 'agent'];

/**
 * 角色权限中间件
 * 检查 req.user.role 是否在允许的角色列表中
 * @param  {...string} roles - 允许的角色列表
 * @returns {Function} Express 中间件
 */
function requireRole(...roles) {
  return (req, res, next) => {
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
 * ERP 访问权限中间件
 * 检查角色是否为 admin/process/agent，其他角色返回 403
 * @returns {Function} Express 中间件
 */
function requireErpAccess() {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new ForbiddenError('无法获取用户角色信息'));
    }

    if (!ERP_ROLES.includes(req.user.role)) {
      return next(new ForbiddenError('您的角色无权访问 ERP 系统'));
    }

    next();
  };
}

/**
 * 管理员权限中间件
 * 仅 admin 角色可访问
 * @returns {Function} Express 中间件
 */
function requireAdmin() {
  return (req, res, next) => {
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
 * 数据隔离过滤器
 * agent 角色只能看到自己的数据（owner_id = user.id 或 created_by = user.id）
 * admin 和 process 可以看到所有数据
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
  const { ownerField = 'owner_id' } = options;

  // admin 和 process 可以看到所有数据
  if (!req.user || req.user.role === 'admin' || req.user.role === 'process') {
    return {};
  }

  // agent 只能看到自己的数据
  if (req.user.role === 'agent') {
    return { [ownerField]: req.user.id };
  }

  // 其他角色不应该到达这里（应被 requireErpAccess 拦截）
  // 但作为安全兜底，返回一个不可能匹配的条件
  return { [ownerField]: -1 };
}

/**
 * 数据隔离中间件（作为 Express 中间件使用）
 * 将数据过滤条件附加到 req.dataFilter 上，供 controller/service 使用
 *
 * 用法：
 *   router.get('/contracts', authenticate, requireErpAccess(), attachDataFilter(), contractController.list);
 *   // 在 controller 中：const filter = req.dataFilter;
 *
 * @param {Object} [options] - 配置选项
 * @param {string} [options.ownerField='owner_id'] - 所有者字段名
 * @returns {Function} Express 中间件
 */
function attachDataFilter(options = {}) {
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
