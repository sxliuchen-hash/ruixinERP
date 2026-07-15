'use strict';

const { ALL_PERMISSION_CODES, PERMISSIONS } = require('./permissionCodes');
const permissionManifest = require('./erp-permission-manifest.json');

const LEGACY_ERP_ROLES = Object.freeze(['admin', 'process', 'agent']);

// 旧系统中这些模块/操作由 requireAdmin 保护。适配器继续保持该行为，
// 以便权限路由迁移后旧账号密码登录不会被意外放大权限。
const LEGACY_ADMIN_ONLY_PERMISSIONS = new Set([
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.WECHAT_VIEW,
  PERMISSIONS.WECHAT_CONFIGURE,
  PERMISSIONS.WECHAT_SYNC,
  PERMISSIONS.EMPLOYEE_VIEW,
  PERMISSIONS.EMPLOYEE_CREATE,
  PERMISSIONS.EMPLOYEE_UPDATE,
  PERMISSIONS.EMPLOYEE_DELETE,
  PERMISSIONS.EMPLOYEE_CHANGE_STATUS,
  PERMISSIONS.PERFORMANCE_IMPORT_VIEW,
  PERMISSIONS.PERFORMANCE_IMPORT_IMPORT,
  PERMISSIONS.PERFORMANCE_IMPORT_DELETE,
  PERMISSIONS.PURCHASE_COMMISSION_VIEW,
  PERMISSIONS.PAYROLL_VIEW,
  PERMISSIONS.PAYROLL_GENERATE,
  PERMISSIONS.PAYROLL_UPDATE,
  PERMISSIONS.PAYROLL_CONFIRM,
  PERMISSIONS.PAYROLL_PAY,
  PERMISSIONS.PAYROLL_VOID,
  PERMISSIONS.PAYROLL_DELETE,
  PERMISSIONS.PAYROLL_EXPORT,
  PERMISSIONS.SALARY_RULE_VIEW,
  PERMISSIONS.SALARY_RULE_UPDATE,
  PERMISSIONS.SALARY_RULE_RESET,
  PERMISSIONS.SYSTEM_VIEW,
  PERMISSIONS.SYSTEM_UPDATE,
  PERMISSIONS.SYSTEM_DELETE,
  PERMISSIONS.CLASSIFY_RULE_VIEW,
  PERMISSIONS.CLASSIFY_RULE_CREATE,
  PERMISSIONS.CLASSIFY_RULE_UPDATE,
  PERMISSIONS.CLASSIFY_RULE_DELETE,
  PERMISSIONS.IMPORT_VIEW,
  PERMISSIONS.IMPORT_VALIDATE,
  PERMISSIONS.IMPORT_EXECUTE,
  PERMISSIONS.INVENTORY_BATCH_DELETE,
  PERMISSIONS.INVENTORY_ANOMALY_SCAN,
  // 旧通用导出权限已废弃；模块级导出在 legacy 灰度期统一收紧为仅 admin，
  // 避免 process/agent 因 invoice/cost 仅支持 all 而获得公司级敏感导出。
  PERMISSIONS.PAYMENT_EXPORT,
  PERMISSIONS.CONTRACT_EXPORT,
  PERMISSIONS.INVENTORY_EXPORT,
  PERMISSIONS.INVOICE_EXPORT,
  PERMISSIONS.EXPENSE_EXPORT,
  PERMISSIONS.PROJECT_EXPORT,
  PERMISSIONS.COST_EXPORT
]);

const SUPPORTED_SCOPES_BY_PERMISSION = new Map(
  permissionManifest.modules.flatMap((module) =>
    module.permissions.map((permission) => [permission.code, permission.scopes])
  )
);
const DEPRECATED_PERMISSION_CODES = new Set(
  permissionManifest.modules.flatMap((module) =>
    module.permissions.filter((permission) => permission.deprecated).map((permission) => permission.code)
  )
);

function buildLegacyPermissions(role) {
  if (!LEGACY_ERP_ROLES.includes(role)) return {};

  const permissions = {};

  for (const permissionCode of ALL_PERMISSION_CODES) {
    if (DEPRECATED_PERMISSION_CODES.has(permissionCode)) continue;
    if (role !== 'admin' && LEGACY_ADMIN_ONLY_PERMISSIONS.has(permissionCode)) {
      continue;
    }
    const supportedScopes = SUPPORTED_SCOPES_BY_PERMISSION.get(permissionCode) || [];
    const scope = role === 'agent' && supportedScopes.includes('self') ? 'self' : 'all';
    if (!supportedScopes.includes(scope)) continue;
    permissions[permissionCode] = { allowed: true, scope };
  }

  return permissions;
}

function getLegacyAuthorizationRole(user) {
  return user?.authSource === 'legacy' ? user.role : null;
}

module.exports = {
  LEGACY_ERP_ROLES,
  LEGACY_ADMIN_ONLY_PERMISSIONS,
  buildLegacyPermissions,
  getLegacyAuthorizationRole
};
