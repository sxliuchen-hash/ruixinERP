const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const {
  createAccountSchema,
  updateAccountSchema,
  setBalanceSchema,
  transferSchema
} = require('../validators/account');

// 所有账户路由需要认证，具体操作由主项目下发的权限控制。
router.use(authenticate);

// GET /api/v1/accounts - 账户列表
router.get('/', requirePermission(PERMISSIONS.ACCOUNT_VIEW), accountController.getList);

// POST /api/v1/accounts - 创建账户
router.post('/',
  requirePermission(PERMISSIONS.ACCOUNT_CREATE),
  requireFreshPermissionVersion(),
  validate(createAccountSchema),
  operationLog('create', 'bank_accounts'),
  accountController.create
);

// PUT /api/v1/accounts/:id - 编辑账户
router.put('/:id',
  requirePermission(PERMISSIONS.ACCOUNT_UPDATE),
  requireFreshPermissionVersion(),
  validate(updateAccountSchema),
  operationLog('update', 'bank_accounts'),
  accountController.update
);

// PUT /api/v1/accounts/:id/balance - 设置期初余额
router.put('/:id/balance',
  requirePermission(PERMISSIONS.ACCOUNT_ADJUST),
  requireFreshPermissionVersion(),
  validate(setBalanceSchema),
  operationLog('update', 'bank_accounts'),
  accountController.setBalance
);

// GET /api/v1/accounts/:id/flow - 账户流水明细
router.get('/:id/flow', requirePermission(PERMISSIONS.ACCOUNT_VIEW), accountController.getFlow);

// POST /api/v1/accounts/transfer - 账户间转账
router.post('/transfer',
  requirePermission(PERMISSIONS.ACCOUNT_TRANSFER),
  requireFreshPermissionVersion(),
  validate(transferSchema),
  operationLog('create', 'account_transfers'),
  accountController.transfer
);

module.exports = router;
