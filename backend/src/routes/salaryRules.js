/**
 * ============================================================
 * 薪资规则路由
 * ============================================================
 * 路由前缀：/api/v1/salary-rules
 * 权限：authenticate + admin（仅管理员可修改规则）
 *       查询接口所有角色可访问（用于前端展示提成规则等）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess, requireAdmin } = require('../middlewares/permission');
const salaryRuleService = require('../services/salaryRuleService');

router.use(authenticate);

// GET /salary-rules - 获取所有规则（所有角色可查看）
router.get('/', requireErpAccess(), async (req, res, next) => {
  try {
    const rules = await salaryRuleService.getAllRules();
    res.json({ success: true, data: rules });
  } catch (e) { next(e); }
});

// GET /salary-rules/:type - 获取指定类型规则
router.get('/:type', requireErpAccess(), async (req, res, next) => {
  try {
    const rule = await salaryRuleService.getRule(req.params.type);
    if (!rule) return res.status(404).json({ success: false, message: '规则不存在' });
    res.json({ success: true, data: rule });
  } catch (e) { next(e); }
});

// POST /salary-rules/init - 初始化默认规则（仅 admin）
router.post('/init', requireAdmin(), async (req, res, next) => {
  try {
    const result = await salaryRuleService.initDefaultRules();
    res.json({ success: true, data: result, message: result.initialized ? '已初始化默认规则' : '规则已存在，无需初始化' });
  } catch (e) { next(e); }
});

// PUT /salary-rules/:type - 更新规则（仅 admin）
router.put('/:type', requireAdmin(), async (req, res, next) => {
  try {
    const rule = await salaryRuleService.updateRule(req.params.type, req.body);
    res.json({ success: true, data: rule, message: '规则已更新' });
  } catch (e) { next(e); }
});

// POST /salary-rules/:type/reset - 重置为默认值（仅 admin）
router.post('/:type/reset', requireAdmin(), async (req, res, next) => {
  try {
    const rule = await salaryRuleService.resetRule(req.params.type);
    res.json({ success: true, data: rule, message: '已重置为默认值' });
  } catch (e) { next(e); }
});

module.exports = router;
