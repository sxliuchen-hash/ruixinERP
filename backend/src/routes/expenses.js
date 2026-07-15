/**
 * ============================================================
 * 报销管理路由
 * ============================================================
 * 路由前缀：/api/v1/expenses（在 routes/index.js 挂载）
 *
 * 中间件栈：
 *   1) authenticate         - JWT 认证
 *   2) requirePermission    - 校验具体业务权限
 *   3) attachPermissionDataScope - 按权限 grant 附加 self/team/all 数据范围
 *   4) validate(schema)     - Joi 校验
 *   5) operationLog         - 异步操作日志
 *
 * 路由注册顺序：
 *   /summary/* 必须放在 /:id 之前，否则会被 /:id 误匹配
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createExpenseSchema,
  updateExpenseSchema,
  listExpenseQuerySchema
} = require('../validators/expense');

router.use(authenticate);

// ===== 汇总接口（必须放在 /:id 之前） =====
router.get('/summary/category',
  requirePermission(PERMISSIONS.EXPENSE_VIEW),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_VIEW, { ownerField: 'created_by' }),
  expenseController.getCategorySummary
);
router.get('/summary/user',
  requirePermission(PERMISSIONS.EXPENSE_VIEW),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_VIEW, { ownerField: 'created_by' }),
  expenseController.getUserSummary
);
router.get('/summary/monthly',
  requirePermission(PERMISSIONS.EXPENSE_VIEW),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_VIEW, { ownerField: 'created_by' }),
  expenseController.getMonthlySummary
);

// ===== 列表 / 详情 =====
router.get('/',
  requirePermission(PERMISSIONS.EXPENSE_VIEW),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_VIEW, { ownerField: 'created_by' }),
  validate(listExpenseQuerySchema, 'query'),
  expenseController.getList
);
router.get('/:id',
  requirePermission(PERMISSIONS.EXPENSE_VIEW),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_VIEW, { ownerField: 'created_by' }),
  expenseController.getDetail
);

// ===== 写入操作 =====
router.post('/',
  requirePermission(PERMISSIONS.EXPENSE_CREATE),
  validate(createExpenseSchema),
  operationLog('create', 'expenses'),
  expenseController.create
);
router.put('/:id',
  requirePermission(PERMISSIONS.EXPENSE_UPDATE),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_UPDATE, { ownerField: 'created_by' }),
  validate(updateExpenseSchema),
  operationLog('update', 'expenses'),
  expenseController.update
);
router.delete('/:id',
  requirePermission(PERMISSIONS.EXPENSE_DELETE),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_DELETE, { ownerField: 'created_by' }),
  operationLog('delete', 'expenses'),
  expenseController.remove
);

// 确认（pending → confirmed）
router.put('/:id/confirm',
  requirePermission(PERMISSIONS.EXPENSE_APPROVE),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.EXPENSE_APPROVE, { ownerField: 'created_by' }),
  operationLog('update', 'expenses'),
  expenseController.confirm
);

module.exports = router;
