'use strict';

/**
 * ERP 权限编码的唯一代码源。
 *
 * 编码一经发布不得直接改名；需要替换时应新增编码，并让旧编码经历
 * deprecated 兼容周期。Manifest、后端路由和前端必须使用这里定义的值。
 */
const PERMISSIONS = Object.freeze({
  APP_VIEW: 'erp.app.view',
  DASHBOARD_VIEW: 'erp.dashboard.view',

  ACCOUNT_VIEW: 'erp.account.view',
  ACCOUNT_CREATE: 'erp.account.create',
  ACCOUNT_UPDATE: 'erp.account.update',
  ACCOUNT_ADJUST: 'erp.account.adjust',
  ACCOUNT_TRANSFER: 'erp.account.transfer',

  CUSTOMER_VIEW: 'erp.customer.view',
  CUSTOMER_CREATE: 'erp.customer.create',
  CUSTOMER_UPDATE: 'erp.customer.update',
  CUSTOMER_DELETE: 'erp.customer.delete',

  SUPPLIER_VIEW: 'erp.supplier.view',
  SUPPLIER_CREATE: 'erp.supplier.create',
  SUPPLIER_UPDATE: 'erp.supplier.update',
  SUPPLIER_DELETE: 'erp.supplier.delete',

  CONTRACT_VIEW: 'erp.contract.view',
  CONTRACT_CREATE: 'erp.contract.create',
  CONTRACT_UPDATE: 'erp.contract.update',
  CONTRACT_DELETE: 'erp.contract.delete',
  CONTRACT_CONFIRM: 'erp.contract.confirm',
  CONTRACT_UPLOAD: 'erp.contract.upload',
  CONTRACT_EXPORT: 'erp.contract.export',

  INVOICE_VIEW: 'erp.invoice.view',
  INVOICE_CREATE: 'erp.invoice.create',
  INVOICE_UPDATE: 'erp.invoice.update',
  INVOICE_DELETE: 'erp.invoice.delete',
  INVOICE_CONFIRM: 'erp.invoice.confirm',
  INVOICE_EXPORT: 'erp.invoice.export',

  PAYMENT_VIEW: 'erp.payment.view',
  PAYMENT_CREATE: 'erp.payment.create',
  PAYMENT_UPDATE: 'erp.payment.update',
  PAYMENT_DELETE: 'erp.payment.delete',
  PAYMENT_CONFIRM: 'erp.payment.confirm',
  PAYMENT_EXPORT: 'erp.payment.export',

  EXPENSE_VIEW: 'erp.expense.view',
  EXPENSE_CREATE: 'erp.expense.create',
  EXPENSE_UPDATE: 'erp.expense.update',
  EXPENSE_DELETE: 'erp.expense.delete',
  EXPENSE_APPROVE: 'erp.expense.approve',
  EXPENSE_EXPORT: 'erp.expense.export',

  LOAN_VIEW: 'erp.loan.view',
  LOAN_CREATE: 'erp.loan.create',
  LOAN_UPDATE: 'erp.loan.update',
  LOAN_DELETE: 'erp.loan.delete',
  LOAN_REPAY: 'erp.loan.repay',

  INVENTORY_VIEW: 'erp.inventory.view',
  INVENTORY_CREATE: 'erp.inventory.create',
  INVENTORY_UPDATE: 'erp.inventory.update',
  INVENTORY_DELETE: 'erp.inventory.delete',
  INVENTORY_IMPORT: 'erp.inventory.import',
  INVENTORY_BATCH_DELETE: 'erp.inventory.batch_delete',
  INVENTORY_SELL: 'erp.inventory.sell',
  INVENTORY_UNSELL: 'erp.inventory.unsell',
  INVENTORY_SYNC: 'erp.inventory.sync',
  INVENTORY_EXPORT: 'erp.inventory.export',

  INVENTORY_ANOMALY_VIEW: 'erp.inventory_anomaly.view',
  INVENTORY_ANOMALY_RESOLVE: 'erp.inventory_anomaly.resolve',
  INVENTORY_ANOMALY_SCAN: 'erp.inventory_anomaly.scan',

  PROJECT_VIEW: 'erp.project.view',
  PROJECT_CREATE: 'erp.project.create',
  PROJECT_UPDATE: 'erp.project.update',
  PROJECT_DELETE: 'erp.project.delete',
  PROJECT_REFRESH: 'erp.project.refresh',
  PROJECT_EXPORT: 'erp.project.export',

  COST_VIEW: 'erp.cost.view',
  COST_CREATE: 'erp.cost.create',
  COST_UPDATE: 'erp.cost.update',
  COST_DELETE: 'erp.cost.delete',
  COST_GENERATE: 'erp.cost.generate',
  COST_EXPORT: 'erp.cost.export',

  RECONCILIATION_VIEW: 'erp.reconciliation.view',
  RECONCILIATION_IMPORT: 'erp.reconciliation.import',
  RECONCILIATION_MATCH: 'erp.reconciliation.match',
  RECONCILIATION_UNMATCH: 'erp.reconciliation.unmatch',
  RECONCILIATION_DELETE: 'erp.reconciliation.delete',

  IMPORT_VIEW: 'erp.import.view',
  IMPORT_VALIDATE: 'erp.import.validate',
  IMPORT_EXECUTE: 'erp.import.execute',
  // 兼容旧权限目录；Manifest 已标记 deprecated，新授权使用各模块 *.export。
  EXPORT_EXECUTE: 'erp.export.export',

  AUDIT_VIEW: 'erp.audit.view',

  WECHAT_VIEW: 'erp.wechat.view',
  WECHAT_CONFIGURE: 'erp.wechat.configure',
  WECHAT_SYNC: 'erp.wechat.sync',

  EMPLOYEE_VIEW: 'erp.employee.view',
  EMPLOYEE_CREATE: 'erp.employee.create',
  EMPLOYEE_UPDATE: 'erp.employee.update',
  EMPLOYEE_DELETE: 'erp.employee.delete',
  EMPLOYEE_CHANGE_STATUS: 'erp.employee.change_status',

  PERFORMANCE_VIEW: 'erp.performance.view',
  PERFORMANCE_EXPORT: 'erp.performance.export',
  PURCHASE_COMMISSION_VIEW: 'erp.purchase_commission.view',

  PERFORMANCE_IMPORT_VIEW: 'erp.performance_import.view',
  PERFORMANCE_IMPORT_IMPORT: 'erp.performance_import.import',
  PERFORMANCE_IMPORT_DELETE: 'erp.performance_import.delete',

  SALARY_RULE_VIEW: 'erp.salary_rule.view',
  SALARY_RULE_UPDATE: 'erp.salary_rule.update',
  SALARY_RULE_RESET: 'erp.salary_rule.reset',

  PAYROLL_VIEW: 'erp.payroll.view',
  PAYROLL_GENERATE: 'erp.payroll.generate',
  PAYROLL_UPDATE: 'erp.payroll.update',
  PAYROLL_CONFIRM: 'erp.payroll.confirm',
  PAYROLL_PAY: 'erp.payroll.pay',
  PAYROLL_VOID: 'erp.payroll.void',
  PAYROLL_DELETE: 'erp.payroll.delete',
  PAYROLL_EXPORT: 'erp.payroll.export',

  PATENT_FEE_VIEW: 'erp.patent_fee.view',

  SYSTEM_VIEW: 'erp.system.view',
  SYSTEM_UPDATE: 'erp.system.update',
  SYSTEM_DELETE: 'erp.system.delete',

  CLASSIFY_RULE_VIEW: 'erp.classify_rule.view',
  CLASSIFY_RULE_CREATE: 'erp.classify_rule.create',
  CLASSIFY_RULE_UPDATE: 'erp.classify_rule.update',
  CLASSIFY_RULE_DELETE: 'erp.classify_rule.delete',

  NOTIFICATION_VIEW: 'erp.notification.view',
  NOTIFICATION_UPDATE: 'erp.notification.update',
  NOTIFICATION_DELETE: 'erp.notification.delete',
  FILE_DOWNLOAD: 'erp.file.download'
});

const ALL_PERMISSION_CODES = Object.freeze(Object.values(PERMISSIONS));
const PERMISSION_CODE_SET = new Set(ALL_PERMISSION_CODES);

function isKnownPermission(permissionCode) {
  return PERMISSION_CODE_SET.has(permissionCode);
}

module.exports = {
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  isKnownPermission
};
