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
const { requireErpAccess } = require('../middlewares/permission');
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
router.use(requireErpAccess());

// ===== 上传 + 查询 =====
router.post('/upload',
  upload.single('file'),
  operationLog('create', 'bank_statements'),
  reconciliationController.upload
);
router.get('/history', reconciliationController.getHistory);
router.get('/result/:batchNo', reconciliationController.getResult);
router.delete('/batch/:batchNo',
  operationLog('delete', 'bank_statements'),
  reconciliationController.deleteBatch
);

// ===== 单条流水操作 =====
router.post('/statements/:id/create-payment',
  operationLog('create', 'payments'),
  reconciliationController.createPaymentFromStatement
);
router.put('/statements/:id/match',
  operationLog('update', 'bank_statements'),
  reconciliationController.manualMatch
);
router.put('/statements/:id/unmatch',
  operationLog('update', 'bank_statements'),
  reconciliationController.unmatch
);
router.put('/statements/:id/ignore',
  operationLog('update', 'bank_statements'),
  reconciliationController.ignore
);

module.exports = router;
