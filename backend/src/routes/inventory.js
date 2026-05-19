/**
 * ============================================================
 * 专利库存管理路由
 * ============================================================
 * 路由前缀：/api/v1/inventory
 *
 * 中间件栈：authenticate → requireErpAccess → attachDataFilter → validate → operationLog
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
const { requireErpAccess, attachDataFilter } = require('../middlewares/permission');
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
  expiringQuerySchema
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
router.use(requireErpAccess());
router.use(attachDataFilter({ ownerField: 'created_by' }));

// ===== 固定路径（必须早于 /:id） =====
router.get('/overview', inventoryController.getOverview);
router.get('/expiring',
  validate(expiringQuerySchema, 'query'),
  inventoryController.getExpiring
);
router.put('/batch-price',
  validate(batchChangePriceSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.batchChangePrice
);

// ===== 批量入库 =====
router.get('/batch-import/template', inventoryController.batchImportTemplate);
router.post('/batch-import/validate',
  upload.single('file'),
  inventoryController.batchImportValidate
);
router.post('/batch-import/execute',
  operationLog('create', 'patent_inventory'),
  inventoryController.batchImportExecute
);

// ===== 列表 / 入库 =====
router.get('/',
  validate(listInventoryQuerySchema, 'query'),
  inventoryController.getList
);
router.post('/',
  validate(createInventorySchema),
  operationLog('create', 'patent_inventory'),
  inventoryController.create
);

// ===== 详情 / 编辑 / 删除 =====
router.get('/:id', inventoryController.getDetail);
router.put('/:id',
  validate(updateInventorySchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.update
);
router.delete('/:id',
  operationLog('delete', 'patent_inventory'),
  inventoryController.remove
);

// ===== 状态 / 调价 =====
router.put('/:id/status',
  validate(changeStatusSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.changeStatus
);
router.put('/:id/price',
  validate(changePriceSchema),
  operationLog('update', 'patent_inventory'),
  inventoryController.changePrice
);

// ===== 年费子资源 =====
router.post('/:id/fees',
  validate(createAnnualFeeSchema),
  operationLog('create', 'patent_annual_fees'),
  inventoryController.addAnnualFee
);
router.delete('/:id/fees/:feeId',
  operationLog('delete', 'patent_annual_fees'),
  inventoryController.deleteAnnualFee
);

// ===== IP 系统数据同步 =====
router.post('/:id/sync-from-ip',
  operationLog('update', 'patent_inventory'),
  inventoryController.syncFromIpSystem
);

module.exports = router;
