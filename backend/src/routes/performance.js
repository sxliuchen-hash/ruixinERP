/**
 * ============================================================
 * 业绩统计路由
 * ============================================================
 * 路由前缀：/api/v1/performance
 * 权限：主项目统一权限编码
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const performanceController = require('../controllers/performanceController');
const { authenticate } = require('../middlewares/auth');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { requirePermission } = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../permissions/permissionCodes');

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));
const requireFreshPermissions = requireFreshPermissionVersion();

// 业绩概览（统计卡片）
router.get('/overview',
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  performanceController.getOverview
);

// 月度排名
router.get('/ranking',
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  performanceController.getRanking
);

// 业绩趋势
router.get('/trend',
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  performanceController.getTrend
);

// 季度汇总（职级考核）
router.get('/quarterly',
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  performanceController.getQuarterly
);

// 提成试算
router.get('/commission',
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  performanceController.calculateCommission
);

// 采购提成月度报表
router.get('/purchase-commission',
  requireFreshPermissions,
  requirePermission(PERMISSIONS.PURCHASE_COMMISSION_VIEW),
  performanceController.getPurchaseCommission
);

module.exports = router;
