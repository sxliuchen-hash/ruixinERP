const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

// ERP 允许的角色（与 authService 保持一致）
const ALLOWED_ROLES = ['admin', 'process', 'agent'];

/**
 * JWT 认证中间件
 * 从 Authorization header 提取 Bearer token，验证后将用户信息附加到 req.user
 * 同时校验角色是否允许访问 ERP 系统
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('未提供认证令牌');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('认证令牌格式错误');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 校验 JWT payload 完整性
    if (!decoded.id || !decoded.username || !decoded.role) {
      throw new UnauthorizedError('认证令牌数据不完整');
    }

    // 校验角色是否允许访问 ERP（拒绝 client/sub_account/sub_department）
    if (!ALLOWED_ROLES.includes(decoded.role)) {
      throw new ForbiddenError('您的角色无权访问 ERP 系统');
    }

    // 将用户信息附加到请求对象
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('认证令牌已过期，请重新登录'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('认证令牌无效'));
    }
    // Pass through AppError instances (UnauthorizedError, ForbiddenError)
    next(error);
  }
}

module.exports = { authenticate };
