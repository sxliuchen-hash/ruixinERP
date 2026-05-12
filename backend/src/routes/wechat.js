/**
 * ============================================================
 * 企业微信路由
 * ============================================================
 * 路由前缀：/api/v1/wechat
 *
 * 路由分两组：
 *
 * 1) 企微回调（无鉴权，只做签名校验）：
 *    GET    /callback     企微后台配置回调时验证（echostr）
 *    POST   /callback     接收企微推送事件（审批/成员变更）
 *
 * 2) 管理接口（admin 鉴权）：
 *    GET    /config       查看企微配置状态
 *    GET    /test-token   测试获取 access_token（诊断）
 *    GET    /users/:userId 查询企微成员信息（诊断）
 *
 * 【XML body 处理】
 *   企微回调 POST body 是 XML（Content-Type: text/xml），
 *   需要在 app.js 主中间件之外单独处理 raw body。
 *   这里用 express.text() 中间件读取原始 XML 文本到 req.body。
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const wechatController = require('../controllers/wechatController');
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/permission');

// ===== 回调组（无鉴权）=====
router.get('/callback', wechatController.verifyCallback);
// 注意：express.text() 可以处理 Content-Type: text/xml
router.post(
  '/callback',
  express.text({ type: ['text/xml', 'application/xml', 'text/plain'] }),
  wechatController.receiveCallback
);

// ===== 管理组（admin 鉴权）=====
router.use(authenticate);
router.use(requireAdmin());

router.get('/config', wechatController.getConfigStatus);
router.get('/test-token', wechatController.testToken);
router.get('/users/:userId', wechatController.getWechatUser);

module.exports = router;
