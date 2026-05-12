const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const { createCustomerSchema, updateCustomerSchema } = require('../validators/customer');

// 所有客户路由需要认证 + ERP 访问权限
router.use(authenticate);
router.use(requireErpAccess());

// GET /api/v1/customers - 客户列表（分页+搜索）
router.get('/', customerController.getList);

// GET /api/v1/customers/:id - 客户详情
router.get('/:id', customerController.getDetail);

// POST /api/v1/customers - 创建客户
router.post('/',
  validate(createCustomerSchema),
  operationLog('create', 'customers'),
  customerController.create
);

// PUT /api/v1/customers/:id - 编辑客户
router.put('/:id',
  validate(updateCustomerSchema),
  operationLog('update', 'customers'),
  customerController.update
);

// DELETE /api/v1/customers/:id - 删除客户（软删除）
router.delete('/:id',
  operationLog('delete', 'customers'),
  customerController.remove
);

// GET /api/v1/customers/:id/transactions - 往来账（关联合同+收付款统计）
router.get('/:id/transactions', customerController.getTransactions);

module.exports = router;
