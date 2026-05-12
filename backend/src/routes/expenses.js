/**
 * ============================================================
 * 报销管理路由
 * ============================================================
 * 路由前缀：/api/v1/expenses（在 routes/index.js 挂载）
 *
 * 中间件栈：
 *   1) authenticate         - JWT 认证
 *   2) requireErpAccess     - 限定 admin/process/agent 角色
 *   3) attachDataFilter     - 数据隔离（agent 仅能看 created_by=自己）
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
const { requireErpAccess, attachDataFilter } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createExpenseSchema,
  updateExpenseSchema,
  listExpenseQuerySchema
} = require('../validators/expense');

router.use(authenticate);
router.use(requireErpAccess());
router.use(attachDataFilter({ ownerField: 'created_by' }));

// ===== 汇总接口（必须放在 /:id 之前） =====
router.get('/summary/category', expenseController.getCategorySummary);
router.get('/summary/user', expenseController.getUserSummary);
router.get('/summary/monthly', expenseController.getMonthlySummary);

// ===== 列表 / 详情 =====
router.get('/',
  validate(listExpenseQuerySchema, 'query'),
  expenseController.getList
);
router.get('/:id', expenseController.getDetail);

// ===== 写入操作 =====
router.post('/',
  validate(createExpenseSchema),
  operationLog('create', 'expenses'),
  expenseController.create
);
router.put('/:id',
  validate(updateExpenseSchema),
  operationLog('update', 'expenses'),
  expenseController.update
);
router.delete('/:id',
  operationLog('delete', 'expenses'),
  expenseController.remove
);

// 确认（pending → confirmed）
router.put('/:id/confirm',
  operationLog('update', 'expenses'),
  expenseController.confirm
);

module.exports = router;
