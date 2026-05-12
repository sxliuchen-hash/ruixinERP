/**
 * ============================================================
 * 交易项目路由
 * ============================================================
 * 路由前缀：/api/v1/projects
 *
 * 中间件栈：authenticate → requireErpAccess → attachDataFilter → validate → operationLog
 *
 * 路由注册顺序：
 *   /summary 必须放在 /:id 之前，/:id/profit 和 /:id/refresh 在动态段之后
 *
 * 资源树：
 *   GET    /                       列表
 *   GET    /summary                利润总览（Dashboard 用）
 *   POST   /                       创建
 *   GET    /:id                    详情（含关联合同/收付款/库存）
 *   GET    /:id/profit             利润明细（Sankey 图数据源）
 *   PUT    /:id                    编辑
 *   PUT    /:id/status             变更状态
 *   POST   /:id/refresh            手动刷新聚合字段
 *   DELETE /:id                    删除（仅解除关联，不删原始单据）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess, attachDataFilter } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createProjectSchema,
  updateProjectSchema,
  listProjectQuerySchema,
  changeProjectStatusSchema,
  summaryQuerySchema
} = require('../validators/project');

router.use(authenticate);
router.use(requireErpAccess());
router.use(attachDataFilter({ ownerField: 'created_by' }));

// ===== 固定路径（必须早于 /:id） =====
router.get('/summary',
  validate(summaryQuerySchema, 'query'),
  projectController.getSummary
);

// ===== 列表 / 创建 =====
router.get('/',
  validate(listProjectQuerySchema, 'query'),
  projectController.getList
);
router.post('/',
  validate(createProjectSchema),
  operationLog('create', 'projects'),
  projectController.create
);

// ===== 详情 / 利润明细 =====
router.get('/:id', projectController.getDetail);
router.get('/:id/profit', projectController.getProfit);

// ===== 编辑 / 状态 / 刷新 / 删除 =====
router.put('/:id',
  validate(updateProjectSchema),
  operationLog('update', 'projects'),
  projectController.update
);
router.put('/:id/status',
  validate(changeProjectStatusSchema),
  operationLog('update', 'projects'),
  projectController.changeStatus
);
router.post('/:id/refresh',
  operationLog('update', 'projects'),
  projectController.refresh
);
router.delete('/:id',
  operationLog('delete', 'projects'),
  projectController.remove
);

module.exports = router;
