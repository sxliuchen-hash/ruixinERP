/**
 * ============================================================
 * 借款管理路由
 * ============================================================
 * 路由前缀：/api/v1/loans
 *
 * 中间件栈：authenticate → requireErpAccess → attachDataFilter → validate → operationLog
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
const { requireErpAccess, attachDataFilter } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createLoanSchema,
  updateLoanSchema,
  listLoanQuerySchema,
  createRepaymentSchema
} = require('../validators/loan');

router.use(authenticate);
router.use(requireErpAccess());
router.use(attachDataFilter({ ownerField: 'created_by' }));

// ===== 汇总接口（必须放在 /:id 之前） =====
router.get('/summary', loanController.getSummary);

// ===== 列表 / 详情 =====
router.get('/',
  validate(listLoanQuerySchema, 'query'),
  loanController.getList
);
router.get('/:id', loanController.getDetail);

// ===== 写入操作 =====
router.post('/',
  validate(createLoanSchema),
  operationLog('create', 'loans'),
  loanController.create
);
router.put('/:id',
  validate(updateLoanSchema),
  operationLog('update', 'loans'),
  loanController.update
);
router.delete('/:id',
  operationLog('delete', 'loans'),
  loanController.remove
);

// ===== 还款子资源 =====
router.post('/:id/repayments',
  validate(createRepaymentSchema),
  operationLog('create', 'loan_repayments'),
  loanController.addRepayment
);
router.delete('/:id/repayments/:repaymentId',
  operationLog('delete', 'loan_repayments'),
  loanController.deleteRepayment
);

module.exports = router;
