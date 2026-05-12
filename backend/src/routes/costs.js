/**
 * ============================================================
 * 成本管理路由
 * ============================================================
 * 路由前缀：/api/v1/costs
 *
 * 中间件栈：authenticate → requireErpAccess → validate → operationLog
 * 注意：成本管理目前不做 agent 数据隔离（成本是公司级数据）
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
const { requireErpAccess, requireAdmin } = require('../middlewares/permission');
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
router.use(requireErpAccess());

// ===== 成本类别 =====
router.get('/categories/tree', costController.getCategoryTree);
router.get('/categories',
  validate(listCategoryQuerySchema, 'query'),
  costController.getCategoryList
);
router.post('/categories',
  requireAdmin(),
  validate(createCategorySchema),
  operationLog('create', 'cost_categories'),
  costController.createCategory
);
router.put('/categories/:id',
  requireAdmin(),
  validate(updateCategorySchema),
  operationLog('update', 'cost_categories'),
  costController.updateCategory
);
router.delete('/categories/:id',
  requireAdmin(),
  operationLog('delete', 'cost_categories'),
  costController.deleteCategory
);

// ===== 汇总分析（放在 /records 之前，避免被误匹配） =====
router.get('/summary/monthly',
  validate(monthlySummaryQuerySchema, 'query'),
  costController.getMonthlySummary
);
router.get('/summary/type',
  validate(breakdownQuerySchema, 'query'),
  costController.getTypeBreakdown
);
router.get('/summary/category',
  validate(breakdownQuerySchema, 'query'),
  costController.getCategoryBreakdown
);
router.get('/summary/yoy-mom',
  validate(yoyMomQuerySchema, 'query'),
  costController.getYoyMom
);

// ===== 固定月费生成（管理员手动触发） =====
router.post('/recurring/generate',
  requireAdmin(),
  validate(generateRecurringSchema),
  operationLog('create', 'cost_records'),
  costController.generateRecurring
);

// ===== 成本记录 =====
router.get('/records',
  validate(listRecordQuerySchema, 'query'),
  costController.getRecordList
);
router.post('/records',
  validate(createRecordSchema),
  operationLog('create', 'cost_records'),
  costController.createRecord
);
router.put('/records/:id',
  validate(updateRecordSchema),
  operationLog('update', 'cost_records'),
  costController.updateRecord
);
router.delete('/records/:id',
  operationLog('delete', 'cost_records'),
  costController.deleteRecord
);

module.exports = router;
