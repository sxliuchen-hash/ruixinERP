/**
 * ============================================================
 * 数据导出路由
 * ============================================================
 * 路由前缀：/api/v1/export
 *
 * 接口均使用 GET，查询参数与对应列表接口一致，便于前端直接复用筛选条件：
 *   GET /export/payments?type=income&start_date=2026-01-01&...
 *
 * 中间件栈：authenticate → requireErpAccess → operationLog（记录导出行为）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');

router.use(authenticate);
router.use(requireErpAccess());

// 导出行为记录到操作日志（target_table 写对应的业务表，action='export' 语义）
const logExport = (table) => operationLog('create', `export_${table}`);

router.get('/payments',   logExport('payments'),          exportController.exportPayments);
router.get('/contracts',  logExport('contracts'),         exportController.exportContracts);
router.get('/inventory',  logExport('patent_inventory'),  exportController.exportInventory);
router.get('/invoices',   logExport('invoices'),          exportController.exportInvoices);
router.get('/expenses',   logExport('expenses'),          exportController.exportExpenses);
router.get('/projects',   logExport('projects'),          exportController.exportProjects);
router.get('/costs',      logExport('cost_records'),      exportController.exportCosts);

module.exports = router;
