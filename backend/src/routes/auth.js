const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
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

// POST /api/v1/auth/login - 用户登录
router.post('/login', loginLimiter, authController.login);

// POST /api/v1/auth/logout - 用户登出
router.post('/logout', authenticate, authController.logout);

// GET /api/v1/auth/profile - 获取当前用户信息
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
