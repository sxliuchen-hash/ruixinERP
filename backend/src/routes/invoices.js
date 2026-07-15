const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { operationLog } = require('../middlewares/operationLog');
const validate = require('../middlewares/validate');
const { createInvoiceSchema, updateInvoiceSchema, updateInvoiceStatusSchema } = require('../validators/invoice');

// 所有发票路由需要认证 + ERP 访问权限
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

// GET /api/v1/invoices - 发票列表
router.get('/', requirePermission(PERMISSIONS.INVOICE_VIEW), invoiceController.getList);

// GET /api/v1/invoices/:id - 发票详情
router.get('/:id', requirePermission(PERMISSIONS.INVOICE_VIEW), invoiceController.getDetail);

// POST /api/v1/invoices - 创建发票
router.post('/',
  requirePermission(PERMISSIONS.INVOICE_CREATE),
  validate(createInvoiceSchema),
  operationLog('create', 'invoices'),
  invoiceController.create
);

// PUT /api/v1/invoices/:id - 更新发票
router.put('/:id',
  requirePermission(PERMISSIONS.INVOICE_UPDATE),
  validate(updateInvoiceSchema),
  operationLog('update', 'invoices'),
  invoiceController.update
);

// DELETE /api/v1/invoices/:id - 删除发票
router.delete('/:id',
  requirePermission(PERMISSIONS.INVOICE_DELETE),
  requireFreshPermissionVersion(),
  operationLog('delete', 'invoices'),
  invoiceController.remove
);

// PUT /api/v1/invoices/:id/status - 更新发票状态
router.put('/:id/status',
  requirePermission(PERMISSIONS.INVOICE_CONFIRM),
  requireFreshPermissionVersion(),
  validate(updateInvoiceStatusSchema),
  operationLog('update', 'invoices'),
  invoiceController.updateStatus
);

module.exports = router;
