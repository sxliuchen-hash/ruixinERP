/**
 * ============================================================
 * 成本管理路由
 * ============================================================
 * 路由前缀：/api/v1/costs
 *
 * 中间件栈：authenticate → erp.app.view → 业务权限码 → validate → operationLog
 * 注意：成本管理是公司级数据，Manifest 仅声明 all scope。
 *
 * 资源树：
 *   GET    /categories                     类别列表（平铺）
 *   GET    /categories/tree                类别树（两级）
 *   POST   /categories                     创建类别
 *   PUT    /categories/:id                 更新类别
 *   DELETE /categories/:id                 删除类别（有引用则拒绝）
 *
 *   GET    /records                        成本记录列表
 *   POST   /records                        创建记录
 *   PUT    /records/:id                    更新记录
 *   DELETE /records/:id                    删除记录
 *
 *   GET    /summary/monthly                月度汇总（近 N 月，含按大类分解）
 *   GET    /summary/type                   按大类汇总（Dashboard 饼图）
 *   GET    /summary/category               按二级类别汇总
 *   GET    /summary/yoy-mom                同比环比
 *
 *   POST   /recurring/generate             固定月费自动生成（管理员触发）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const costController = require('../controllers/costController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createCategorySchema,
  updateCategorySchema,
  listCategoryQuerySchema,
  createRecordSchema,
  updateRecordSchema,
  listRecordQuerySchema,
  monthlySummaryQuerySchema,
  breakdownQuerySchema,
  yoyMomQuerySchema,
  generateRecurringSchema
} = require('../validators/cost');

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

// ===== 成本类别 =====
router.get('/categories/tree', requirePermission(PERMISSIONS.COST_VIEW), costController.getCategoryTree);
router.get('/categories',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(listCategoryQuerySchema, 'query'),
  costController.getCategoryList
);
router.post('/categories',
  requirePermission(PERMISSIONS.COST_CREATE),
  validate(createCategorySchema),
  operationLog('create', 'cost_categories'),
  costController.createCategory
);
router.put('/categories/:id',
  requirePermission(PERMISSIONS.COST_UPDATE),
  requireFreshPermissionVersion(),
  validate(updateCategorySchema),
  operationLog('update', 'cost_categories'),
  costController.updateCategory
);
router.delete('/categories/:id',
  requirePermission(PERMISSIONS.COST_DELETE),
  requireFreshPermissionVersion(),
  operationLog('delete', 'cost_categories'),
  costController.deleteCategory
);

// ===== 汇总分析（放在 /records 之前，避免被误匹配） =====
router.get('/summary/monthly',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(monthlySummaryQuerySchema, 'query'),
  costController.getMonthlySummary
);
router.get('/summary/type',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(breakdownQuerySchema, 'query'),
  costController.getTypeBreakdown
);
router.get('/summary/category',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(breakdownQuerySchema, 'query'),
  costController.getCategoryBreakdown
);
router.get('/summary/yoy-mom',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(yoyMomQuerySchema, 'query'),
  costController.getYoyMom
);

// ===== 固定月费生成（管理员手动触发） =====
router.post('/recurring/generate',
  requirePermission(PERMISSIONS.COST_GENERATE),
  requireFreshPermissionVersion(),
  validate(generateRecurringSchema),
  operationLog('create', 'cost_records'),
  costController.generateRecurring
);

// ===== 成本记录 =====
router.get('/records',
  requirePermission(PERMISSIONS.COST_VIEW),
  validate(listRecordQuerySchema, 'query'),
  costController.getRecordList
);
router.post('/records',
  requirePermission(PERMISSIONS.COST_CREATE),
  validate(createRecordSchema),
  operationLog('create', 'cost_records'),
  costController.createRecord
);
router.put('/records/:id',
  requirePermission(PERMISSIONS.COST_UPDATE),
  requireFreshPermissionVersion(),
  validate(updateRecordSchema),
  operationLog('update', 'cost_records'),
  costController.updateRecord
);
router.delete('/records/:id',
  requirePermission(PERMISSIONS.COST_DELETE),
  requireFreshPermissionVersion(),
  operationLog('delete', 'cost_records'),
  costController.deleteRecord
);

module.exports = router;
