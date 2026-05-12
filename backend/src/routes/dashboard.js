/**
 * ============================================================
 * Dashboard 路由
 * ============================================================
 * 路由前缀：/api/v1/dashboard（在 routes/index.js 挂载）
 *
 * 权限：authenticate + requireErpAccess（admin/process/agent 均可访问）
 *
 * 所有接口均为 GET，聚合查询，无写操作，无需 operationLog。
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');

router.use(authenticate);
router.use(requireErpAccess());

// 核心指标：现金流/应收应付/毛利润 —— 支持 ?period=month|quarter|year
router.get('/overview', dashboardController.getOverview);

// 各银行账户实时余额
router.get('/accounts', dashboardController.getAccounts);

// 近 12 个月收支趋势
router.get('/trend', dashboardController.getTrend);

// 成本构成（费用类 payments 按成本类别分组）—— 支持 ?period=xxx
router.get('/cost-breakdown', dashboardController.getCostBreakdown);

// 待确认单据数量（payments + contracts）
router.get('/pending', dashboardController.getPending);

// 应收账龄分布（5 档）
router.get('/aging', dashboardController.getAging);

module.exports = router;
