const authService = require('../services/authService');
const { ValidationError, ForbiddenError } = require('../utils/errors');
const { isPasswordLoginEnabled, getAuthFeatures } = require('../config/authFeatures');

function features(req, res) {
  res.json({
    success: true,
    data: getAuthFeatures()
  });
}

/**
 * 用户登录
 * POST /api/v1/auth/login
 * Body: { username, password }
 */
async function login(req, res, next) {
  try {
    if (!isPasswordLoginEnabled()) {
      throw new ForbiddenError('ERP 密码登录已关闭，请从主项目进入');
    }

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
    const profile = req.user.authSource === 'main_sso'
      ? {
          id: req.user.id,
          username: req.user.username,
          realName: req.user.realName,
          email: req.user.email,
          phone: req.user.phone,
          role: req.user.role,
          departmentName: req.user.departmentName
        }
      : await authService.getProfile(userId);

    res.json({
      success: true,
      data: {
        ...profile,
        permissions: req.user.permissions,
        permissionVersion: req.user.permissionVersion,
        authSource: req.user.authSource
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  features,
  login,
  logout,
  getProfile
};
