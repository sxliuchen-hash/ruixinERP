const express = require('express');
const router = express.Router();
const multer = require('multer');
const contractController = require('../controllers/contractController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createContractSchema,
  updateContractSchema,
  updateStatusSchema,
  listQuerySchema
} = require('../validators/contract');

// 文件上传配置（内存存储，后续上传到 COS）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅支持 PDF、图片、Word 文档'));
    }
  }
});

const contractScope = (permissionCode) => attachPermissionDataScope(permissionCode);

// 所有合同路由需要认证 + ERP 应用入口权限；具体动作权限在各路由声明。
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

// GET /api/v1/contracts - 合同列表
router.get('/',
  requirePermission(PERMISSIONS.CONTRACT_VIEW),
  contractScope(PERMISSIONS.CONTRACT_VIEW),
  validate(listQuerySchema, 'query'),
  contractController.getList
);

// GET /api/v1/contracts/:id - 合同详情
router.get('/:id',
  requirePermission(PERMISSIONS.CONTRACT_VIEW),
  contractScope(PERMISSIONS.CONTRACT_VIEW),
  contractController.getDetail
);

// POST /api/v1/contracts - 创建合同
router.post('/',
  requirePermission(PERMISSIONS.CONTRACT_CREATE),
  validate(createContractSchema),
  operationLog('create', 'contracts'),
  contractController.create
);

// PUT /api/v1/contracts/:id - 更新合同
router.put('/:id',
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  contractScope(PERMISSIONS.CONTRACT_UPDATE),
  validate(updateContractSchema),
  operationLog('update', 'contracts'),
  contractController.update
);

// DELETE /api/v1/contracts/:id - 删除合同（软删除）
router.delete('/:id',
  requirePermission(PERMISSIONS.CONTRACT_DELETE),
  requireFreshPermissionVersion(),
  contractScope(PERMISSIONS.CONTRACT_DELETE),
  operationLog('delete', 'contracts'),
  contractController.remove
);

// PUT /api/v1/contracts/:id/status - 更新合同状态
router.put('/:id/status',
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  contractScope(PERMISSIONS.CONTRACT_UPDATE),
  validate(updateStatusSchema),
  operationLog('update', 'contracts'),
  contractController.updateStatus
);

// PUT /api/v1/contracts/:id/confirm - 确认合同
router.put('/:id/confirm',
  requirePermission(PERMISSIONS.CONTRACT_CONFIRM),
  requireFreshPermissionVersion(),
  contractScope(PERMISSIONS.CONTRACT_CONFIRM),
  operationLog('update', 'contracts'),
  contractController.confirm
);

// POST /api/v1/contracts/:id/attachment - 上传附件
router.post('/:id/attachment',
  requirePermission(PERMISSIONS.CONTRACT_UPLOAD),
  contractScope(PERMISSIONS.CONTRACT_UPLOAD),
  upload.single('file'),
  operationLog('update', 'contracts'),
  contractController.uploadAttachment
);

module.exports = router;
