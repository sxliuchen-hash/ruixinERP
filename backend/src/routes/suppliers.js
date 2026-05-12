const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const { createSupplierSchema, updateSupplierSchema } = require('../validators/supplier');

// 所有供应商路由需要认证 + ERP 访问权限
router.use(authenticate);
router.use(requireErpAccess());

// GET /api/v1/suppliers - 供应商列表（分页+搜索）
router.get('/', supplierController.getList);

// GET /api/v1/suppliers/:id - 供应商详情
router.get('/:id', supplierController.getDetail);

// POST /api/v1/suppliers - 创建供应商
router.post('/',
  validate(createSupplierSchema),
  operationLog('create', 'suppliers'),
  supplierController.create
);

// PUT /api/v1/suppliers/:id - 编辑供应商
router.put('/:id',
  validate(updateSupplierSchema),
  operationLog('update', 'suppliers'),
  supplierController.update
);

// DELETE /api/v1/suppliers/:id - 删除供应商（软删除）
router.delete('/:id',
  operationLog('delete', 'suppliers'),
  supplierController.remove
);

// GET /api/v1/suppliers/:id/transactions - 往来账（关联合同+收付款统计）
router.get('/:id/transactions', supplierController.getTransactions);

module.exports = router;
