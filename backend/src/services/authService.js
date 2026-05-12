const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const MainUser = require('../models/MainUser');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

// 允许登录 ERP 的角色（拒绝 client/sub_account/sub_department）
const ALLOWED_ROLES = ['admin', 'process', 'agent'];

class AuthService {
  /**
   * 用户登录
   * 从 patent_notice_system.users 表验证用户名密码
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{token: string, user: object}>}
   */
  async login(username, password) {
    // 使用 MainUser 模型的 withPassword scope 查询（包含 password 字段）
    const user = await MainUser.scope('withPassword').findOne({
      where: { username }
    });

    if (!user) {
      throw new UnauthorizedError('用户名或密码错误');
    }

    // 检查用户状态
    if (user.status !== 1) {
      throw new ForbiddenError('账号已被禁用，请联系管理员');
    }

    // 检查角色：只允许 admin/process/agent 登录 ERP
    if (!ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenError('您的角色无权访问 ERP 系统');
    }

    // 验证密码（bcrypt 比较）
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('用户名或密码错误');
    }

    // 生成 JWT
    const token = this.generateToken(user);

    // 返回用户信息（不含密码）
    const userInfo = {
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      departmentName: user.departmentName
    };

    logger.info(`用户 ${username} 登录成功，角色: ${user.role}`);

    return { token, user: userInfo };
  }

  /**
   * 获取当前用户信息
   * 从 patent_notice_system.users 表读取（不含密码）
   * @param {number} userId
   * @returns {Promise<object>}
   */
  async getProfile(userId) {
    // 使用默认 scope（排除 password 字段）
    const user = await MainUser.findByPk(userId);

    if (!user) {
      throw new UnauthorizedError('用户不存在');
    }

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      departmentName: user.departmentName
    };
  }

  /**
   * 验证 token 有效性（供中间件或其他服务调用）
   * @param {string} token
   * @returns {object} decoded payload
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedError('认证令牌已过期，请重新登录');
      }
      throw new UnauthorizedError('认证令牌无效');
    }
  }

  /**
   * 生成 JWT Token
   * payload: {id, username, role}
   * @param {object} user
   * @returns {string}
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
  }
}

module.exports = new AuthService();
