const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

// POST /api/v1/auth/login - 用户登录
router.post('/login', authController.login);

// POST /api/v1/auth/logout - 用户登出
router.post('/logout', authenticate, authController.logout);

// GET /api/v1/auth/profile - 获取当前用户信息
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
