/**
 * ============================================================
 * 专利库存管理路由
 * ============================================================
 * 路由前缀：/api/v1/inventory
 *
 * 中间件栈：authenticate → erp.app.view → 业务权限码 → scope → validate → operationLog
 *
 * 路由注册顺序要点：
 *   /overview /expiring /batch-price 必须放在 /:id 之前，避免被参数化路由误匹配
 *
 * 资源树：
 *   GET    /                       列表（支持库龄/技术领域/排序筛选）
 *   GET    /overview               库存总览统计
 *   GET    /expiring                即将到期列表
 *   POST   /                       入库
 *   PUT    /batch-price            批量调价
 *   GET    /:id                    详情
 *   PUT    /:id                    编辑
 *   DELETE /:id                    删除（级联年费+历史）
 *   PUT    /:id/status             变更状态
 *   PUT    /:id/price              单个调价
 *   POST   /:id/fees               添加年费
 *   DELETE /:id/fees/:feeId        删除年费
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const inventoryController = require('../controllers/inventoryController');
const { authenticate } = require('../middlewares/auth');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { requirePermission } = require('../middlewares/requirePermission');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createInventorySchema,
  updateInventorySchema,
  listInventoryQuerySchema,
  changeStatusSchema,
  changePriceSchema,
  batchChangePriceSchema,
  createAnnualFeeSchema,
  expiringQuerySchema,
  markAsSoldSchema,
  soldListQuerySchema,
  soldAnalyticsQuerySchema
} = require('../validators/inventory');

// multer 内存存储（批量导入用）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 或 .xls 格式'));
    }
  }
});

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

const requireFreshPermissions = requireFreshPermissionVersion();
const inventoryScope = (permissionCode) => attachPermissionDataScope(permissionCode, {
  ownerField: 'created_by'
});

// ===== 固定路径（必须早于 /:id） =====
router.get('/overview',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getOverview
);
router.get('/expiring',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  validate(expiringQuerySchema, 'query'),
  inventoryController.getExpiring
);
router.put('/batch-price',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  validate(batchChangePriceSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.batchChangePrice
);

// ===== 批量入库 =====
router.get('/batch-import/template',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_IMPORT),
  inventoryController.batchImportTemplate
);
router.post('/batch-import/validate',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_IMPORT),
  upload.single('file'),
  inventoryController.batchImportValidate
);
router.post('/batch-import/execute',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_IMPORT),
  operationLog('create', 'patent_inventory'),
  inventoryController.batchImportExecute
);

// ===== 批量删除（仅管理员） =====
router.post('/batch-delete',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_BATCH_DELETE),
  inventoryScope(PERMISSIONS.INVENTORY_BATCH_DELETE),
  operationLog('delete', 'patent_inventory'),
  inventoryController.batchDelete
);

// ===== 已售归档 =====
router.get('/sold',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  validate(soldListQuerySchema, 'query'),
  inventoryController.getSoldList
);
router.get('/sold/stats',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getSoldStats
);
router.get('/sold/analytics',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  validate(soldAnalyticsQuerySchema, 'query'),
  inventoryController.getSoldAnalytics
);

// ===== 异常告警 =====
router.get('/anomalies', requirePermission(PERMISSIONS.INVENTORY_ANOMALY_VIEW), inventoryController.getAnomalies);
router.get('/anomalies/overview', requirePermission(PERMISSIONS.INVENTORY_ANOMALY_VIEW), inventoryController.getAnomalyOverview);
router.get('/anomalies/scan-progress', requirePermission(PERMISSIONS.INVENTORY_ANOMALY_VIEW), inventoryController.getScanProgress);
router.post('/anomalies/scan-stop',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_ANOMALY_SCAN),
  inventoryController.stopScan
);
router.put('/anomalies/:id/resolve',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_ANOMALY_RESOLVE),
  operationLog('update', 'patent_anomaly_alerts'),
  inventoryController.resolveAnomaly
);
router.post('/anomalies/scan',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.INVENTORY_ANOMALY_SCAN),
  operationLog('create', 'patent_anomaly_scan'),
  inventoryController.triggerAnomalyScan
);

// ===== 列表 / 入库 =====
router.get('/',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  validate(listInventoryQuerySchema, 'query'),
  inventoryController.getList
);
router.post('/',
  requirePermission(PERMISSIONS.INVENTORY_CREATE),
  validate(createInventorySchema),
  operationLog('create', 'patent_inventory'),
  inventoryController.create
);

// ===== 详情 / 编辑 / 删除 =====
router.get('/:id',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryScope(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getDetail
);
router.put('/:id',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  validate(updateInventorySchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.update
);
router.delete('/:id',
  requirePermission(PERMISSIONS.INVENTORY_DELETE),
  requireFreshPermissions,
  inventoryScope(PERMISSIONS.INVENTORY_DELETE),
  operationLog('delete', 'patent_inventory'),
  inventoryController.remove
);

// ===== 状态 / 调价 =====
router.put('/:id/status',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  validate(changeStatusSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.changeStatus
);
router.put('/:id/price',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  validate(changePriceSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.changePrice
);

// ===== 年费子资源 =====
router.post('/:id/fees',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  validate(createAnnualFeeSchema),
  operationLog('create', 'patent_annual_fees'),
  inventoryController.addAnnualFee
);
router.delete('/:id/fees/:feeId',
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  inventoryScope(PERMISSIONS.INVENTORY_UPDATE),
  operationLog('delete', 'patent_annual_fees'),
  inventoryController.deleteAnnualFee
);

// ===== IP 系统数据同步 =====
router.post('/:id/sync-from-ip',
  requirePermission(PERMISSIONS.INVENTORY_SYNC),
  requireFreshPermissions,
  inventoryScope(PERMISSIONS.INVENTORY_SYNC),
  operationLog('update', 'patent_inventory'),
  inventoryController.syncFromIpSystem
);

// ===== 已售操作 =====
router.post('/:id/sell',
  requirePermission(PERMISSIONS.INVENTORY_SELL),
  requireFreshPermissions,
  inventoryScope(PERMISSIONS.INVENTORY_SELL),
  validate(markAsSoldSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.markAsSold
);
router.post('/:id/unsell',
  requirePermission(PERMISSIONS.INVENTORY_UNSELL),
  requireFreshPermissions,
  inventoryScope(PERMISSIONS.INVENTORY_UNSELL),
  operationLog('update', 'patent_inventory'),
  inventoryController.unsell
);

module.exports = router;
