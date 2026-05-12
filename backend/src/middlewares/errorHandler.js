const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * 全局错误处理中间件
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // 默认错误信息
  let statusCode = err.statusCode || 500;
  let message = err.message || '服务器内部错误';
  let code = err.code || 'INTERNAL_ERROR';

  // Sequelize 验证错误
  if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.errors.map(e => e.message).join('; ');
  }

  // Sequelize 唯一约束错误
  if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    code = 'DUPLICATE_ERROR';
    message = '数据已存在，请勿重复提交';
  }

  // JWT 错误
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = '无效的认证令牌';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = '认证令牌已过期，请重新登录';
  }

  // 记录错误日志
  if (statusCode >= 500) {
    logger.error('服务器错误:', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip
    });
  } else {
    logger.warn('客户端错误:', {
      message: err.message,
      statusCode,
      url: req.originalUrl,
      method: req.method
    });
  }

  // 生产环境不暴露内部错误详情
  if (process.env.NODE_ENV === 'production' && !(err instanceof AppError)) {
    message = '服务器内部错误';
  }

  res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
