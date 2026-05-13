/**
 * ============================================================
 * 员工档案路由
 * ============================================================
 * 路由前缀：/api/v1/employees
 * 仅 admin 可操作 CRUD
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/permission');
const Employee = require('../models/Employee');

router.use(authenticate);
router.use(requireAdmin());

// GET /employees - 员工列表
router.get('/', async (req, res, next) => {
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
router.get('/:id', async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ message: '员工不存在' });
    res.json({ success: true, data: employee });
  } catch (e) { next(e); }
});

// POST /employees - 新建员工
router.post('/', async (req, res, next) => {
  try {
    const employee = await Employee.create(req.body);
    res.json({ success: true, data: employee, message: '创建成功' });
  } catch (e) { next(e); }
});

// PUT /employees/:id - 更新员工
router.put('/:id', async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ message: '员工不存在' });
    await employee.update(req.body);
    res.json({ success: true, data: employee, message: '更新成功' });
  } catch (e) { next(e); }
});

// DELETE /employees/:id - 删除员工
router.delete('/:id', async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ message: '员工不存在' });
    await employee.destroy();
    res.json({ success: true, message: '已删除' });
  } catch (e) { next(e); }
});

// PUT /employees/:id/grade - 变更职级
router.put('/:id/grade', async (req, res, next) => {
  try {
    const { grade } = req.body;
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ message: '员工不存在' });
    await employee.update({ grade });
    res.json({ success: true, message: `职级已变更为 ${grade}` });
  } catch (e) { next(e); }
});

// PUT /employees/:id/status - 变更状态（转正/离职）
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status, regular_date, resign_date } = req.body;
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ message: '员工不存在' });

    const updateData = { status };
    if (status === 'regular' && regular_date) updateData.regular_date = regular_date;
    if (status === 'resigned' && resign_date) updateData.resign_date = resign_date;

    await employee.update(updateData);
    res.json({ success: true, message: '状态已变更' });
  } catch (e) { next(e); }
});

module.exports = router;
