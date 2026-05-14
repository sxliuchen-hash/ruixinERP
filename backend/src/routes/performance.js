/**
 * ============================================================
 * 业绩统计路由
 * ============================================================
 * 路由前缀：/api/v1/performance
 * 权限：authenticate + requireErpAccess（admin/process/agent 均可访问）
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const performanceController = require('../controllers/performanceController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');

router.use(authenticate);
router.use(requireErpAccess());

// 业绩概览（统计卡片）
router.get('/overview', performanceController.getOverview);

// 月度排名
router.get('/ranking', performanceController.getRanking);

// 业绩趋势
router.get('/trend', performanceController.getTrend);

// 季度汇总（职级考核）
router.get('/quarterly', performanceController.getQuarterly);

// 提成试算
router.get('/commission', performanceController.calculateCommission);

module.exports = router;
