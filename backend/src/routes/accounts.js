const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createAccountSchema,
  updateAccountSchema,
  setBalanceSchema,
  transferSchema
} = require('../validators/account');

// 所有账户路由需要认证 + ERP 访问权限
router.use(authenticate);
router.use(requireErpAccess());

// GET /api/v1/accounts - 账户列表
router.get('/', accountController.getList);

// POST /api/v1/accounts - 创建账户
router.post('/',
  validate(createAccountSchema),
  operationLog('create', 'bank_accounts'),
  accountController.create
);

// PUT /api/v1/accounts/:id - 编辑账户
router.put('/:id',
  validate(updateAccountSchema),
  operationLog('update', 'bank_accounts'),
  accountController.update
);

// PUT /api/v1/accounts/:id/balance - 设置期初余额
router.put('/:id/balance',
  validate(setBalanceSchema),
  operationLog('update', 'bank_accounts'),
  accountController.setBalance
);

// GET /api/v1/accounts/:id/flow - 账户流水明细
router.get('/:id/flow', accountController.getFlow);

// POST /api/v1/accounts/transfer - 账户间转账
router.post('/transfer',
  validate(transferSchema),
  operationLog('create', 'account_transfers'),
  accountController.transfer
);

module.exports = router;
