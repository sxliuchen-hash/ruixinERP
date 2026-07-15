const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');
const {
  isPasswordLoginEnabled,
  isLegacySessionEnabled
} = require('../config/authFeatures');
const {
  LEGACY_ERP_ROLES,
  buildLegacyPermissions
} = require('../permissions/legacyRoleAdapter');

function getMainUserModel() {
  // 主项目模型只允许旧认证路径按需加载，避免全量 SSO 启动时创建主库依赖。
  return require('../models/MainUser');
}

class AuthService {
  /**
   * 用户登录
   * 从 patent_notice_system.users 表验证用户名密码
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{token: string, user: object}>}
   */
  async login(username, password) {
    if (!isPasswordLoginEnabled() || !isLegacySessionEnabled()) {
      throw new ForbiddenError('ERP 密码登录已关闭，请从主项目进入');
    }

    const MainUser = getMainUserModel();
    // 使用 MainUser 模型的 withPassword scope 查询（包含 password 字段）
    const user = await MainUser.scope('withPassword').findOne({
      where: { username },
      attributes: [
        'id', 'username', 'password', 'role', 'status',
        'realName', 'email', 'phone', 'departmentName'
      ]
    });

    if (!user) {
      throw new UnauthorizedError('用户名或密码错误');
    }

    // 检查用户状态
    if (user.status !== 1) {
      throw new ForbiddenError('账号已被禁用，请联系管理员');
    }

    // 检查角色：只允许 admin/process/agent 登录 ERP
    if (!LEGACY_ERP_ROLES.includes(user.role)) {
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

    return {
      token,
      user: {
        ...userInfo,
        authSource: 'legacy',
        permissionVersion: 0
      },
      permissions: buildLegacyPermissions(user.role),
      permissionVersion: 0,
      authSource: 'legacy'
    };
  }

  /**
   * 获取当前用户信息
   * 从 patent_notice_system.users 表读取（不含密码）
   * @param {number} userId
   * @returns {Promise<object>}
   */
  async getProfile(userId) {
    if (!isLegacySessionEnabled()) {
      throw new UnauthorizedError('旧版 ERP 会话已失效，请从主项目重新进入');
    }

    const MainUser = getMainUserModel();
    // 使用默认 scope（排除 password 字段）
    const user = await MainUser.findByPk(userId, {
      attributes: [
        'id', 'username', 'realName', 'email', 'phone',
        'role', 'status', 'departmentName'
      ]
    });

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
    if (!isLegacySessionEnabled() || !process.env.JWT_SECRET) {
      throw new UnauthorizedError('旧版 ERP 会话已失效，请从主项目重新进入');
    }
    try {
      return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
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
    if (!isPasswordLoginEnabled() || !isLegacySessionEnabled() || !process.env.JWT_SECRET) {
      throw new ForbiddenError('ERP 密码登录已关闭，请从主项目进入');
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      authSource: 'legacy'
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
  }
}

module.exports = new AuthService();
