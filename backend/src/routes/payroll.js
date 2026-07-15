/**
 * ============================================================
 * 工资条路由
 * ============================================================
 * 路由前缀：/api/v1/payroll
 * 权限：authenticate + 工资条细粒度权限
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const payrollService = require('../services/payrollService');

router.use(authenticate);

// POST /payroll/generate - 生成指定月份工资条
router.post('/generate', requirePermission(PERMISSIONS.PAYROLL_GENERATE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: '请指定年月' });
    }
    const result = await payrollService.generate(parseInt(year), parseInt(month));
    res.json({ success: true, data: result, message: `已生成 ${result.created} 条，跳过 ${result.skipped} 条` });
  } catch (e) { next(e); }
});

// GET /payroll - 查询工资条列表
router.get('/', requirePermission(PERMISSIONS.PAYROLL_VIEW), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.list(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// GET /payroll/summary - 月度汇总
router.get('/summary', requirePermission(PERMISSIONS.PAYROLL_VIEW), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: '请指定年月' });
    }
    const data = await payrollService.getMonthlySummary(parseInt(year), parseInt(month));
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// PUT /payroll/:id - 编辑工资条（手动字段）
router.put('/:id', requirePermission(PERMISSIONS.PAYROLL_UPDATE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.update(parseInt(req.params.id), req.body);
    res.json({ success: true, data, message: '已更新' });
  } catch (e) { next(e); }
});

// POST /payroll/:id/recalculate - 重新计算
router.post('/:id/recalculate', requirePermission(PERMISSIONS.PAYROLL_UPDATE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.recalculate(parseInt(req.params.id));
    res.json({ success: true, data, message: '已重算' });
  } catch (e) { next(e); }
});

// POST /payroll/:id/confirm - 确认
router.post('/:id/confirm', requirePermission(PERMISSIONS.PAYROLL_CONFIRM), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.confirm(parseInt(req.params.id), req.user.id);
    res.json({ success: true, data, message: '已确认' });
  } catch (e) { next(e); }
});

// POST /payroll/confirm-batch - 批量确认
router.post('/confirm-batch', requirePermission(PERMISSIONS.PAYROLL_CONFIRM), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    const data = await payrollService.confirmBatch(parseInt(year), parseInt(month), req.user.id);
    res.json({ success: true, data, message: `已确认 ${data.confirmed} 条` });
  } catch (e) { next(e); }
});

// POST /payroll/:id/paid - 标记已发放
router.post('/:id/paid', requirePermission(PERMISSIONS.PAYROLL_PAY), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.markPaid(parseInt(req.params.id));
    res.json({ success: true, data, message: '已标记发放' });
  } catch (e) { next(e); }
});

// POST /payroll/:id/void - 作废（已确认/已发放可作废）
router.post('/:id/void', requirePermission(PERMISSIONS.PAYROLL_VOID), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const data = await payrollService.voidPayroll(parseInt(req.params.id), req.body.reason);
    res.json({ success: true, data, message: '已作废' });
  } catch (e) { next(e); }
});

// POST /payroll/adjustment - 新增调整项工资条（补发/补扣）
router.post('/adjustment', requirePermission(PERMISSIONS.PAYROLL_UPDATE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { employee_id, year, month } = req.body;
    if (!employee_id || !year || !month) {
      return res.status(400).json({ success: false, message: '请指定员工和年月' });
    }
    const data = await payrollService.addAdjustment(req.body);
    res.json({ success: true, data, message: '已新增调整项' });
  } catch (e) { next(e); }
});

// DELETE /payroll/:id - 删除（仅 draft）
router.delete('/:id', requirePermission(PERMISSIONS.PAYROLL_DELETE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    await payrollService.remove(parseInt(req.params.id));
    res.json({ success: true, message: '已删除' });
  } catch (e) { next(e); }
});

module.exports = router;
