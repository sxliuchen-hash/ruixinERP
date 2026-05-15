/**
 * ============================================================
 * 专利年费查询路由（代理 IP 系统）
 * ============================================================
 * 路由前缀：/api/v1/patent-fee
 *
 * 中间件栈：authenticate → requireErpAccess
 *
 * 资源树：
 *   GET /list                 年费列表（分页、筛选）
 *   GET /dashboard            年费统计面板
 *   GET /detail/:patentNo     单个专利完整年费详情
 *   GET /info/:patentNo       专利基本信息（发明人/代理/IPC等）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const patentFeeController = require('../controllers/patentFeeController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');

router.use(authenticate);
router.use(requireErpAccess());

// 年费列表
router.get('/list', patentFeeController.getFeeList);

// 年费统计面板
router.get('/dashboard', patentFeeController.getFeeDashboard);

// 单个专利年费详情
router.get('/detail/:patentNo', patentFeeController.getFeeDetail);

// 专利基本信息
router.get('/info/:patentNo', patentFeeController.getPatentInfo);

module.exports = router;
