/**
 * ============================================================
 * 数据导出路由
 * ============================================================
 * 路由前缀：/api/v1/export
 *
 * 接口均使用 GET，查询参数与对应列表接口一致，便于前端直接复用筛选条件：
 *   GET /export/payments?type=income&start_date=2026-01-01&...
 *
 * 中间件栈：authenticate → 实时权限版本 → view/export 权限交集 → scope → operationLog
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { attachCombinedPermissionDataScope } = require('../permissions/dataScope');
const { operationLog } = require('../middlewares/operationLog');

router.use(authenticate);

// 导出行为记录到操作日志（target_table 写对应的业务表，action='export' 语义）
const logExport = (table) => operationLog('create', `export_${table}`);

router.use(requireFreshPermissionVersion());

const scopedExport = (viewPermission, exportPermission, options = {}) => [
  requirePermission(viewPermission),
  requirePermission(exportPermission),
  attachCombinedPermissionDataScope([viewPermission, exportPermission], options)
];

router.get('/payments',
  ...scopedExport(PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT, {
    ownerField: 'created_by'
  }),
  logExport('payments'),
  exportController.exportPayments
);
router.get('/contracts',
  ...scopedExport(PERMISSIONS.CONTRACT_VIEW, PERMISSIONS.CONTRACT_EXPORT, {
    ownerField: 'owner_id'
  }),
  logExport('contracts'),
  exportController.exportContracts
);
router.get('/inventory',
  ...scopedExport(PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EXPORT, {
    ownerField: 'created_by'
  }),
  logExport('patent_inventory'),
  exportController.exportInventory
);
router.get('/invoices',
  ...scopedExport(PERMISSIONS.INVOICE_VIEW, PERMISSIONS.INVOICE_EXPORT),
  logExport('invoices'),
  exportController.exportInvoices
);
router.get('/expenses',
  ...scopedExport(PERMISSIONS.EXPENSE_VIEW, PERMISSIONS.EXPENSE_EXPORT, {
    ownerField: 'created_by'
  }),
  logExport('expenses'),
  exportController.exportExpenses
);
router.get('/projects',
  ...scopedExport(PERMISSIONS.PROJECT_VIEW, PERMISSIONS.PROJECT_EXPORT, {
    ownerFields: ['created_by', 'owner_id']
  }),
  logExport('projects'),
  exportController.exportProjects
);
router.get('/costs',
  ...scopedExport(PERMISSIONS.COST_VIEW, PERMISSIONS.COST_EXPORT),
  logExport('cost_records'),
  exportController.exportCosts
);
router.get('/payroll',
  ...scopedExport(PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_EXPORT),
  logExport('payrolls'),
  exportController.exportPayroll
);

module.exports = router;
