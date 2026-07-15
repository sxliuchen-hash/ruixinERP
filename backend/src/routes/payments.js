/**
 * ============================================================
 * 收付款路由
 * ============================================================
 * 路由前缀：/api/v1/payments（在 routes/index.js 挂载）
 *
 * 中间件栈：
 *   1) authenticate              - JWT 认证
 *   2) requirePermission         - 校验具体业务权限
 *   3) attachPermissionDataScope - 按权限 grant 附加 self/team/all 数据范围
 *   4) validate(schema)          - 参数级 Joi 校验（仅写入/查询接口）
 *   5) operationLog              - 异步写入操作日志（仅写入接口）
 *
 * 路由注册顺序要点：
 *   /receivable 和 /payable 必须放在 /:id 之前，否则 Express 会把它们当成 id 参数
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createPaymentSchema,
  updatePaymentSchema,
  listQuerySchema
} = require('../validators/payment');

// 全局只做认证；每条路由声明自己的功能权限和数据范围。
router.use(authenticate);

// ===== 汇总接口（须放在 /:id 之前，避免被误匹配） =====
router.get('/receivable',
  requirePermission(PERMISSIONS.PAYMENT_VIEW),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_VIEW, { ownerField: 'created_by' }),
  paymentController.getReceivable
);
router.get('/payable',
  requirePermission(PERMISSIONS.PAYMENT_VIEW),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_VIEW, { ownerField: 'created_by' }),
  paymentController.getPayable
);

// ===== 列表与详情 =====
router.get('/',
  requirePermission(PERMISSIONS.PAYMENT_VIEW),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_VIEW, { ownerField: 'created_by' }),
  validate(listQuerySchema, 'query'),
  paymentController.getList
);
router.get('/:id',
  requirePermission(PERMISSIONS.PAYMENT_VIEW),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_VIEW, { ownerField: 'created_by' }),
  paymentController.getDetail
);

// ===== 写入操作（含 Joi 校验 + 操作日志） =====
router.post('/',
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  requireFreshPermissionVersion(),
  validate(createPaymentSchema),
  operationLog('create', 'payments'),
  paymentController.create
);
router.put('/:id',
  requirePermission(PERMISSIONS.PAYMENT_UPDATE),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_UPDATE, { ownerField: 'created_by' }),
  validate(updatePaymentSchema),
  operationLog('update', 'payments'),
  paymentController.update
);
router.delete('/:id',
  requirePermission(PERMISSIONS.PAYMENT_DELETE),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_DELETE, { ownerField: 'created_by' }),
  operationLog('delete', 'payments'),
  paymentController.remove
);

// 确认：pending → confirmed（业务类会联动合同 paid_amount）
router.put('/:id/confirm',
  requirePermission(PERMISSIONS.PAYMENT_CONFIRM),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.PAYMENT_CONFIRM, { ownerField: 'created_by' }),
  operationLog('update', 'payments'),
  paymentController.confirm
);

module.exports = router;
