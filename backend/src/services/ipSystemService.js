/**
 * ============================================================
 * IP 系统 API 客户端服务（ipSystemService）
 * ============================================================
 * 对接知识产权官文管理系统（iptt.top），复用其专利年费查询数据。
 *
 * 【认证方式】
 *   ERP 与 IP 系统共用 users 表和 JWT Secret，
 *   因此 ERP 用户的 Token 可直接用于调用 IP 系统 API。
 *
 * 【可用接口】
 *   - GET /patent-fee/list       年费列表（分页）
 *   - GET /patent-fee/dashboard  年费统计面板
 *   - GET /patent-fee/detail/:no 单个专利年费详情
 *   - GET /patents/no/:no        专利基本信息
 *
 * 【注意事项】
 *   - 数据非实时，由 IP 系统定时任务每天更新
 *   - API 有频率限制，单次请求间隔 > 500ms
 *   - Token 有效期默认 24h（IP 系统侧），ERP 侧为 7d
 * ============================================================
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

// IP 系统 API 基础地址（同服务器优先用内网）
const IP_API_BASE = process.env.IP_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';

// 请求超时（毫秒）
const REQUEST_TIMEOUT = 15000;

class IpSystemService {
  /**
   * 创建带认证的 axios 实例
   * @param {string} token - 当前用户的 JWT Token
   * @returns {import('axios').AxiosInstance}
   */
  _createClient(token) {
    return axios.create({
      baseURL: IP_API_BASE,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 从请求头中提取 Token
   * @param {import('express').Request} req
   * @returns {string}
   */
  _extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('无法获取认证令牌', 401, 'UNAUTHORIZED');
    }
    return authHeader.split(' ')[1];
  }

  /**
   * 统一处理 IP 系统响应
   * @param {import('axios').AxiosResponse} response
   * @returns {any} data 字段
   */
  _handleResponse(response) {
    const { data } = response;
    if (data && data.code === 200) {
      return data.data;
    }
    // IP 系统返回了非 200 的业务码
    const msg = data?.message || 'IP 系统返回异常';
    throw new AppError(msg, 502, 'IP_SYSTEM_ERROR');
  }

  /**
   * 统一处理请求异常
   * @param {Error} error
   */
  _handleError(error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error.response) {
      const status = error.response.status;
      const msg = error.response.data?.message || `IP 系统返回 ${status}`;
      if (status === 401) {
        throw new AppError('IP 系统认证失败，请重新登录', 401, 'IP_AUTH_FAILED');
      }
      if (status === 403) {
        throw new AppError('无权访问 IP 系统资源', 403, 'IP_FORBIDDEN');
      }
      if (status === 404) {
        throw new AppError('IP 系统未找到该专利信息', 404, 'IP_NOT_FOUND');
      }
      throw new AppError(msg, 502, 'IP_SYSTEM_ERROR');
    }
    if (error.code === 'ECONNABORTED') {
      throw new AppError('IP 系统请求超时', 504, 'IP_TIMEOUT');
    }
    logger.error('IP 系统请求异常:', error.message);
    throw new AppError('无法连接 IP 系统', 502, 'IP_UNREACHABLE');
  }

  /**
   * 获取单个专利的年费详情（含应缴/已缴/发文/质押/许可/变更）
   * @param {string} patentNo - 专利号
   * @param {import('express').Request} req - Express 请求对象（用于提取 Token）
   * @returns {Promise<Object>} 年费详情数据
   */
  async getPatentFeeDetail(patentNo, req) {
    const token = this._extractToken(req);
    const client = this._createClient(token);

    try {
      const response = await client.get(`/patent-fee/detail/${encodeURIComponent(patentNo)}`);
      return this._handleResponse(response);
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * 获取专利基本信息（含 patent_details）
   * @param {string} patentNo - 专利号
   * @param {import('express').Request} req
   * @returns {Promise<Object>}
   */
  async getPatentInfo(patentNo, req) {
    const token = this._extractToken(req);
    const client = this._createClient(token);

    try {
      const response = await client.get(`/patents/no/${encodeURIComponent(patentNo)}`);
      return this._handleResponse(response);
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * 获取年费列表（分页）
   * @param {Object} params - 查询参数
   * @param {import('express').Request} req
   * @returns {Promise<Object>} { list, total, page, pageSize }
   */
  async getPatentFeeList(params, req) {
    const token = this._extractToken(req);
    const client = this._createClient(token);

    try {
      const response = await client.get('/patent-fee/list', { params });
      return this._handleResponse(response);
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * 获取年费统计面板
   * @param {import('express').Request} req
   * @returns {Promise<Object>} { urgent, warning, overdue, normal, terminated, total }
   */
  async getPatentFeeDashboard(req) {
    const token = this._extractToken(req);
    const client = this._createClient(token);

    try {
      const response = await client.get('/patent-fee/dashboard');
      return this._handleResponse(response);
    } catch (error) {
      this._handleError(error);
    }
  }
}

module.exports = new IpSystemService();
