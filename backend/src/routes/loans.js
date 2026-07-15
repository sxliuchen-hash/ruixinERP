/**
 * ============================================================
 * 借款管理路由
 * ============================================================
 * 路由前缀：/api/v1/loans
 *
 * 中间件栈：authenticate → requirePermission → attachPermissionDataScope → validate → operationLog
 *
 * 特别说明：
 *   - /summary 必须放在 /:id 之前
 *   - 还款子资源：
 *       POST   /:id/repayments              新增还款
 *       DELETE /:id/repayments/:repaymentId 删除还款
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createLoanSchema,
  updateLoanSchema,
  listLoanQuerySchema,
  createRepaymentSchema
} = require('../validators/loan');

router.use(authenticate);

// ===== 汇总接口（必须放在 /:id 之前） =====
router.get('/summary',
  requirePermission(PERMISSIONS.LOAN_VIEW),
  attachPermissionDataScope(PERMISSIONS.LOAN_VIEW, { ownerField: 'created_by' }),
  loanController.getSummary
);

// ===== 列表 / 详情 =====
router.get('/',
  requirePermission(PERMISSIONS.LOAN_VIEW),
  attachPermissionDataScope(PERMISSIONS.LOAN_VIEW, { ownerField: 'created_by' }),
  validate(listLoanQuerySchema, 'query'),
  loanController.getList
);
router.get('/:id',
  requirePermission(PERMISSIONS.LOAN_VIEW),
  attachPermissionDataScope(PERMISSIONS.LOAN_VIEW, { ownerField: 'created_by' }),
  loanController.getDetail
);

// ===== 写入操作 =====
router.post('/',
  requirePermission(PERMISSIONS.LOAN_CREATE),
  validate(createLoanSchema),
  operationLog('create', 'loans'),
  loanController.create
);
router.put('/:id',
  requirePermission(PERMISSIONS.LOAN_UPDATE),
  attachPermissionDataScope(PERMISSIONS.LOAN_UPDATE, { ownerField: 'created_by' }),
  validate(updateLoanSchema),
  operationLog('update', 'loans'),
  loanController.update
);
router.delete('/:id',
  requirePermission(PERMISSIONS.LOAN_DELETE),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.LOAN_DELETE, { ownerField: 'created_by' }),
  operationLog('delete', 'loans'),
  loanController.remove
);

// ===== 还款子资源 =====
router.post('/:id/repayments',
  requirePermission(PERMISSIONS.LOAN_REPAY),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.LOAN_REPAY, { ownerField: 'created_by' }),
  validate(createRepaymentSchema),
  operationLog('create', 'loan_repayments'),
  loanController.addRepayment
);
router.delete('/:id/repayments/:repaymentId',
  requirePermission(PERMISSIONS.LOAN_REPAY),
  requireFreshPermissionVersion(),
  attachPermissionDataScope(PERMISSIONS.LOAN_REPAY, { ownerField: 'created_by' }),
  operationLog('delete', 'loan_repayments'),
  loanController.deleteRepayment
);

module.exports = router;
