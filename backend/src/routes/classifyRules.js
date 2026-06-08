/**
 * ============================================================
 * 自动归类规则路由
 * ============================================================
 * 路由前缀：/api/v1/classify-rules
 * 权限：authenticate + admin
 *
 * classify_rules 表（关键词 → 成本类别）目前无独立 Sequelize 模型，
 * 这里用原生 SQL 操作（与 reconciliationService._suggestCategory 一致）。
 *
 * 接口：
 *   GET    /            规则列表（按优先级降序）
 *   POST   /            新增规则
 *   PUT    /:id         更新规则
 *   DELETE /:id         删除规则
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');

router.use(authenticate);
router.use(requireAdmin());

// 列表
router.get('/', async (req, res, next) => {
  try {
    const rows = await sequelize.query(
      `SELECT r.id, r.keyword, r.category_id, r.priority, r.status, r.create_time,
              c.name AS category_name
       FROM classify_rules r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       ORDER BY r.priority DESC, r.id ASC`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

// 新增
router.post('/', operationLog('create', 'classify_rules'), async (req, res, next) => {
  try {
    const { keyword, category_id, priority = 0, status = 1 } = req.body;
    if (!keyword || !category_id) {
      return res.status(400).json({ success: false, message: '关键词和类别不能为空' });
    }
    const [id] = await sequelize.query(
      `INSERT INTO classify_rules (keyword, category_id, priority, status)
       VALUES (:keyword, :category_id, :priority, :status)`,
      { replacements: { keyword: String(keyword).trim(), category_id, priority, status }, type: QueryTypes.INSERT }
    );
    res.json({ success: true, data: { id }, message: '已创建' });
  } catch (e) { next(e); }
});

// 更新
router.put('/:id', operationLog('update', 'classify_rules'), async (req, res, next) => {
  try {
    const { keyword, category_id, priority, status } = req.body;
    const sets = [];
    const replacements = { id: parseInt(req.params.id) };
    if (keyword !== undefined) { sets.push('keyword = :keyword'); replacements.keyword = String(keyword).trim(); }
    if (category_id !== undefined) { sets.push('category_id = :category_id'); replacements.category_id = category_id; }
    if (priority !== undefined) { sets.push('priority = :priority'); replacements.priority = priority; }
    if (status !== undefined) { sets.push('status = :status'); replacements.status = status; }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    await sequelize.query(
      `UPDATE classify_rules SET ${sets.join(', ')} WHERE id = :id`,
      { replacements, type: QueryTypes.UPDATE }
    );
    res.json({ success: true, message: '已更新' });
  } catch (e) { next(e); }
});

// 删除
router.delete('/:id', operationLog('delete', 'classify_rules'), async (req, res, next) => {
  try {
    await sequelize.query(
      `DELETE FROM classify_rules WHERE id = :id`,
      { replacements: { id: parseInt(req.params.id) }, type: QueryTypes.DELETE }
    );
    res.json({ success: true, message: '已删除' });
  } catch (e) { next(e); }
});

module.exports = router;
