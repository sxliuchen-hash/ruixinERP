/**
 * ============================================================
 * 银行对账路由
 * ============================================================
 * 路由前缀：/api/v1/reconciliation
 *
 * 路由注册：
 *   POST   /upload                      上传 Excel（multipart）
 *   GET    /history                     对账历史列表
 *   GET    /result/:batchNo             单批次对账结果
 *   DELETE /batch/:batchNo               删除批次
 *
 *   POST   /statements/:id/create-payment  从流水创建付款
 *   PUT    /statements/:id/match           手动匹配
 *   PUT    /statements/:id/unmatch         解除匹配
 *   PUT    /statements/:id/ignore          忽略
 *
 * 【multer 内存存储】
 *   文件直接转成 Buffer 处理，不落盘。限制 10MB。
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const reconciliationController = require('../controllers/reconciliationController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx?$/i.test(file.originalname);
    if (!ok) return cb(new Error('仅支持 .xlsx / .xls 文件'));
    cb(null, true);
  }
});

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

// ===== 上传 + 查询 =====
router.post('/upload',
  requirePermission(PERMISSIONS.RECONCILIATION_IMPORT),
  requireFreshPermissionVersion(),
  upload.single('file'),
  operationLog('create', 'bank_statements'),
  reconciliationController.upload
);
router.get('/history', requirePermission(PERMISSIONS.RECONCILIATION_VIEW), reconciliationController.getHistory);
router.get('/result/:batchNo', requirePermission(PERMISSIONS.RECONCILIATION_VIEW), reconciliationController.getResult);
router.delete('/batch/:batchNo',
  requirePermission(PERMISSIONS.RECONCILIATION_DELETE),
  requireFreshPermissionVersion(),
  operationLog('delete', 'bank_statements'),
  reconciliationController.deleteBatch
);

// ===== 单条流水操作 =====
router.post('/statements/:id/create-payment',
  requirePermission(PERMISSIONS.RECONCILIATION_MATCH),
  requireFreshPermissionVersion(),
  operationLog('create', 'payments'),
  reconciliationController.createPaymentFromStatement
);
router.put('/statements/:id/match',
  requirePermission(PERMISSIONS.RECONCILIATION_MATCH),
  requireFreshPermissionVersion(),
  operationLog('update', 'bank_statements'),
  reconciliationController.manualMatch
);
router.put('/statements/:id/unmatch',
  requirePermission(PERMISSIONS.RECONCILIATION_UNMATCH),
  requireFreshPermissionVersion(),
  operationLog('update', 'bank_statements'),
  reconciliationController.unmatch
);
router.put('/statements/:id/ignore',
  requirePermission(PERMISSIONS.RECONCILIATION_MATCH),
  requireFreshPermissionVersion(),
  operationLog('update', 'bank_statements'),
  reconciliationController.ignore
);

module.exports = router;
