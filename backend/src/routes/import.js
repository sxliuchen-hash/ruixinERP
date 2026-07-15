/**
 * ============================================================
 * 历史数据导入路由
 * ============================================================
 * 路由前缀：/api/v1/import
 *
 * 接口：
 *   GET  /import/template/:type   下载导入模板（contracts/payments/inventory/costs）
 *   POST /import/validate/:type   上传 Excel 预览校验
 *   POST /import/execute/:type    确认导入（事务批量写入）
 *
 * 中间件栈：authenticate → requirePermission → multer → controller
 * 下载、校验、执行分别使用独立权限，默认由主项目权限中心配置。
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('../controllers/importController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');

// multer 内存存储，限制 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // 仅允许 .xlsx / .xls
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 或 .xls 格式'));
    }
  }
});

router.use(authenticate);

// 下载模板（无需 multer）
router.get(
  '/template/:type',
  requirePermission(PERMISSIONS.IMPORT_VIEW),
  operationLog('create', 'import_template'),
  importController.downloadTemplate
);

// 上传校验
router.post(
  '/validate/:type',
  requirePermission(PERMISSIONS.IMPORT_VALIDATE),
  requireFreshPermissionVersion(),
  upload.single('file'),
  importController.validateFile
);

// 确认导入
router.post(
  '/execute/:type',
  requirePermission(PERMISSIONS.IMPORT_EXECUTE),
  requireFreshPermissionVersion(),
  operationLog('create', 'import_execute'),
  importController.executeImport
);

module.exports = router;
