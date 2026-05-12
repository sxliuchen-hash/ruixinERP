/**
 * ============================================================
 * 收付款路由
 * ============================================================
 * 路由前缀：/api/v1/payments（在 routes/index.js 挂载）
 *
 * 中间件栈：
 *   1) authenticate              - JWT 认证
 *   2) requireErpAccess          - 限定 admin/process/agent 角色
 *   3) attachDataFilter          - 附加 req.dataFilter，agent 只看自己的记录
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
const { requireErpAccess, attachDataFilter } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createPaymentSchema,
  updatePaymentSchema,
  listQuerySchema
} = require('../validators/payment');

// 全局中间件：认证 → 权限 → 数据隔离
router.use(authenticate);
router.use(requireErpAccess());
router.use(attachDataFilter({ ownerField: 'created_by' }));

// ===== 汇总接口（须放在 /:id 之前，避免被误匹配） =====
router.get('/receivable', paymentController.getReceivable);
router.get('/payable', paymentController.getPayable);

// ===== 列表与详情 =====
router.get('/',
  validate(listQuerySchema, 'query'),
  paymentController.getList
);
router.get('/:id', paymentController.getDetail);

// ===== 写入操作（含 Joi 校验 + 操作日志） =====
router.post('/',
  validate(createPaymentSchema),
  operationLog('create', 'payments'),
  paymentController.create
);
router.put('/:id',
  validate(updatePaymentSchema),
  operationLog('update', 'payments'),
  paymentController.update
);
router.delete('/:id',
  operationLog('delete', 'payments'),
  paymentController.remove
);

// 确认：pending → confirmed（业务类会联动合同 paid_amount）
router.put('/:id/confirm',
  operationLog('update', 'payments'),
  paymentController.confirm
);

module.exports = router;
