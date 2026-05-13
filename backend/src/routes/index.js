/**
 * 路由注册中心
 * 统一挂载所有业务路由
 */
const express = require('express');
const router = express.Router();

// 认证路由（无需 auth 中间件）
router.use('/auth', require('./auth'));

// 银行账户
router.use('/accounts', require('./accounts'));

// 客户管理
router.use('/customers', require('./customers'));

// 供应商管理
router.use('/suppliers', require('./suppliers'));

// 合同管理
router.use('/contracts', require('./contracts'));

// 发票管理
router.use('/invoices', require('./invoices'));

// 收付款管理
router.use('/payments', require('./payments'));

// Dashboard 看板
router.use('/dashboard', require('./dashboard'));

// ===== Phase 2 =====
// 报销（T12）
router.use('/expenses', require('./expenses'));
// 借款（T12）
router.use('/loans', require('./loans'));

// ===== Phase 3 =====
// 专利库存（T14）
router.use('/inventory', require('./inventory'));
// 交易项目（T16）
router.use('/projects', require('./projects'));
// 成本管理（T17）
router.use('/costs', require('./costs'));
// 系统消息（T15）
router.use('/notifications', require('./notifications'));
// 企业微信（T9）
router.use('/wechat', require('./wechat'));

// ===== Phase 4 =====
// 银行流水对账（T18）
router.use('/reconciliation', require('./reconciliation'));
// 数据导出（T19）
router.use('/export', require('./export'));
// 历史数据导入（T20）
router.use('/import', require('./import'));
// 操作日志
router.use('/logs', require('./logs'));

// TODO: Phase 2 剩余
// router.use('/wechat', require('./wechat'));

// TODO: Phase 3
// router.use('/projects', require('./projects'));
// router.use('/inventory', require('./inventory'));
// router.use('/costs', require('./costs'));

// TODO: Phase 4
// router.use('/reconciliation', require('./reconciliation'));
// router.use('/export', require('./export'));
// router.use('/import', require('./import'));
// router.use('/config', require('./config'));
// router.use('/logs', require('./logs'));

module.exports = router;
