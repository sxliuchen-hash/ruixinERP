/**
 * ============================================================
 * 操作日志路由
 * ============================================================
 * 路由前缀：/api/v1/logs
 * 仅 admin 可访问
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/permission');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

router.use(authenticate);
router.use(requireAdmin());

/**
 * GET /api/v1/logs - 查询操作日志
 * 支持筛选：user_id, action, target_table, start_date, end_date
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, user_id, action, target_table, start_date, end_date } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    let where = '1=1';
    const params = [];

    if (user_id) { where += ' AND l.user_id = ?'; params.push(user_id); }
    if (action) { where += ' AND l.action = ?'; params.push(action); }
    if (target_table) { where += ' AND l.target_table LIKE ?'; params.push(`%${target_table}%`); }
    if (start_date) { where += ' AND l.create_time >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND l.create_time <= ?'; params.push(end_date + ' 23:59:59'); }

    const [countResult] = await sequelize.query(
      `SELECT COUNT(*) as total FROM operation_logs l WHERE ${where}`,
      { replacements: params, type: QueryTypes.SELECT }
    );

    const logs = await sequelize.query(
      `SELECT l.*, u.real_name as user_name
       FROM operation_logs l
       LEFT JOIN patent_notice_system.users u ON u.id = l.user_id
       WHERE ${where}
       ORDER BY l.create_time DESC
       LIMIT ? OFFSET ?`,
      { replacements: [...params, limit, offset], type: QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        list: logs,
        pagination: { page: parseInt(page), pageSize: limit, total: countResult.total }
      }
    });
  } catch (e) { next(e); }
});

module.exports = router;
