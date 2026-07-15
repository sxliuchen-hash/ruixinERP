const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const ssoController = require('../controllers/ssoController');
const { authenticate } = require('../middlewares/auth');

// 登录专用限流：按 IP 仅统计失败请求（成功登录不计数），缓解暴力破解
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 分钟
  max: 10,                  // 每个 IP 最多 10 次失败尝试
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'LOGIN_RATE_LIMIT',
    message: '登录尝试过于频繁，请 10 分钟后再试'
  }
});

const ssoExchangeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'SSO_RATE_LIMIT',
    message: '单点登录请求过于频繁，请稍后再试'
  }
});

const ssoInitiateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'SSO_RATE_LIMIT',
    message: '单点登录请求过于频繁，请稍后再试'
  }
});

// GET /api/v1/auth/features - 登录页公开读取认证开关，不返回任何凭证
router.get('/features', authController.features);

// POST /api/v1/auth/login - 用户登录
router.post('/login', loginLimiter, authController.login);

// POST /api/v1/auth/sso/initiate - 创建服务端 state 并绑定当前浏览器 HttpOnly Cookie
router.post('/sso/initiate', ssoInitiateLimiter, ssoController.initiate);

// POST /api/v1/auth/sso/exchange - 使用主项目一次性授权码和 state 建立 ERP 会话
router.post('/sso/exchange', ssoExchangeLimiter, ssoController.exchange);

// POST /api/v1/auth/logout - 用户登出
router.post('/logout', authenticate, authController.logout);

// GET /api/v1/auth/profile - 获取当前用户信息
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
