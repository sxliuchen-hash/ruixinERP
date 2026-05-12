const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const { createInvoiceSchema, updateInvoiceSchema, updateInvoiceStatusSchema } = require('../validators/invoice');

// 所有发票路由需要认证 + ERP 访问权限
router.use(authenticate);
router.use(requireErpAccess());

// GET /api/v1/invoices - 发票列表
router.get('/', invoiceController.getList);

// GET /api/v1/invoices/:id - 发票详情
router.get('/:id', invoiceController.getDetail);

// POST /api/v1/invoices - 创建发票
router.post('/',
  validate(createInvoiceSchema),
  operationLog('create', 'invoices'),
  invoiceController.create
);

// PUT /api/v1/invoices/:id - 更新发票
router.put('/:id',
  validate(updateInvoiceSchema),
  operationLog('update', 'invoices'),
  invoiceController.update
);

// DELETE /api/v1/invoices/:id - 删除发票
router.delete('/:id',
  operationLog('delete', 'invoices'),
  invoiceController.remove
);

// PUT /api/v1/invoices/:id/status - 更新发票状态
router.put('/:id/status',
  validate(updateInvoiceStatusSchema),
  operationLog('update', 'invoices'),
  invoiceController.updateStatus
);

module.exports = router;
