/**
 * ============================================================
 * 员工档案路由
 * ============================================================
 * 路由前缀：/api/v1/employees
 * 由员工档案细粒度权限控制 CRUD 和状态变更
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const { NotFoundError } = require('../utils/errors');
const validate = require('../middlewares/validate');
const { createEmployeeSchema, updateEmployeeSchema } = require('../validators/employee');
const Employee = require('../models/Employee');
const employeeService = require('../services/employeeService');

router.use(authenticate);

// GET /employees - 员工列表
router.get('/', requirePermission(PERMISSIONS.EMPLOYEE_VIEW), async (req, res, next) => {
  try {
    const { status, role } = req.query;
    const where = {};
    if (status) where.status = status;
    if (role) where.role = role;

    const employees = await Employee.findAll({
      where,
      order: [['role', 'ASC'], ['name', 'ASC']]
    });
    res.json({ success: true, data: employees });
  } catch (e) { next(e); }
});

// GET /employees/:id - 员工详情
router.get('/:id', requirePermission(PERMISSIONS.EMPLOYEE_VIEW), async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) throw new NotFoundError('员工不存在');
    res.json({ success: true, data: employee });
  } catch (e) { next(e); }
});

// POST /employees - 新建员工
router.post('/', requirePermission(PERMISSIONS.EMPLOYEE_CREATE), requireFreshPermissionVersion(), validate(createEmployeeSchema), async (req, res, next) => {
  try {
    const employee = await employeeService.create(req.body);
    res.json({ success: true, data: employee, message: '创建成功' });
  } catch (e) { next(e); }
});

// PUT /employees/:id - 更新员工
router.put('/:id', requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), requireFreshPermissionVersion(), validate(updateEmployeeSchema), async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) throw new NotFoundError('员工不存在');
    await employeeService.update(employee, req.body);
    res.json({ success: true, data: employee, message: '更新成功' });
  } catch (e) { next(e); }
});

// DELETE /employees/:id - 删除员工
router.delete('/:id', requirePermission(PERMISSIONS.EMPLOYEE_DELETE), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) throw new NotFoundError('员工不存在');
    await employee.destroy();
    res.json({ success: true, message: '已删除' });
  } catch (e) { next(e); }
});

// PUT /employees/:id/grade - 变更职级
router.put('/:id/grade', requirePermission(PERMISSIONS.EMPLOYEE_CHANGE_STATUS), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { grade } = req.body;
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) throw new NotFoundError('员工不存在');
    await employee.update({ grade });
    res.json({ success: true, message: `职级已变更为 ${grade}` });
  } catch (e) { next(e); }
});

// PUT /employees/:id/status - 变更状态（转正/离职）
router.put('/:id/status', requirePermission(PERMISSIONS.EMPLOYEE_CHANGE_STATUS), requireFreshPermissionVersion(), async (req, res, next) => {
  try {
    const { status, regular_date, resign_date } = req.body;
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) throw new NotFoundError('员工不存在');

    const updateData = { status };
    if (status === 'regular' && regular_date) updateData.regular_date = regular_date;
    if (status === 'resigned' && resign_date) updateData.resign_date = resign_date;

    await employee.update(updateData);
    res.json({ success: true, message: '状态已变更' });
  } catch (e) { next(e); }
});

module.exports = router;
