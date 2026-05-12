const authService = require('../services/authService');
const { ValidationError } = require('../utils/errors');

/**
 * 用户登录
 * POST /api/v1/auth/login
 * Body: { username, password }
 */
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new ValidationError('用户名和密码不能为空');
    }

    // 去除用户名前后空格
    const trimmedUsername = username.trim();

    if (trimmedUsername.length === 0) {
      throw new ValidationError('用户名不能为空');
    }

    const result = await authService.login(trimmedUsername, password);

    res.json({
      success: true,
      message: '登录成功',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 用户登出
 * POST /api/v1/auth/logout
 * 前端清除 token 即可，后端返回成功
 * 如需 token 黑名单可在此扩展（Redis blacklist）
 */
async function logout(req, res) {
  // 当前实现：前端清除 token 即可
  // 后续可扩展：将 token 加入 Redis 黑名单
  res.json({
    success: true,
    message: '登出成功'
  });
}

/**
 * 获取当前用户信息
 * GET /api/v1/auth/profile
 * 需要认证（authenticate 中间件）
 */
async function getProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const profile = await authService.getProfile(userId);

    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  logout,
  getProfile
};
