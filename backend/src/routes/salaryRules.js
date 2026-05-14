/**
 * ============================================================
 * 薪资规则路由
 * ============================================================
 * 路由前缀：/api/v1/salary-rules
 * 权限：admin 可读写，其他角色只读
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess, requireAdmin } = require('../middlewares/permission');
const salaryRuleService = require('../services/salaryRuleService');

router.use(authenticate);
router.use(requireErpAccess());

// GET /salary-rules - 获取所有规则（按分类分组）
router.get('/', async (req, res, next) => {
  try {
    const data = await salaryRuleService.getAllRules();
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// GET /salary-rules/:key - 获取单条规则
router.get('/:key', async (req, res, next) => {
  try {
    const data = await salaryRuleService.getRuleByKey(req.params.key);
    if (!data) return res.status(404).json({ success: false, message: '规则不存在' });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /salary-rules/init - 初始化默认规则（仅 admin）
router.post('/init', requireAdmin(), async (req, res, next) => {
  try {
    const result = await salaryRuleService.initDefaultRules();
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

// PUT /salary-rules/:id - 更新规则（仅 admin）
router.put('/:id', requireAdmin(), async (req, res, next) => {
  try {
    const data = await salaryRuleService.updateRule(req.params.id, req.body);
    res.json({ success: true, data, message: '规则已更新' });
  } catch (e) { next(e); }
});

module.exports = router;
