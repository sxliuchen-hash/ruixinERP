/**
 * ============================================================
 * 企业微信 API 服务（WechatApiService）
 * ============================================================
 *
 * 【职责】
 *   1) 管理 access_token（Redis 缓存，自动续期）
 *   2) 提供企微 API 调用的薄封装（审批/通讯录/消息）
 *   3) 统一的错误处理和重试
 *
 * 【access_token 策略】
 *   - Redis 缓存 key: erp:wechat:access_token
 *   - TTL 7100 秒（企微默认 7200，留 100 秒冗余）
 *   - 首次获取或过期时自动重新请求
 *   - 若 API 返回 42001/40014 等 token 失效错误码，强制刷新一次重试
 *
 * 【错误处理】
 *   - 企微 API 全部返回 `{errcode, errmsg}`，errcode=0 表示成功
 *   - 非 0 抛出 Error，携带 errcode 和 errmsg
 *
 * 【依赖】
 *   Node 18+ 原生 fetch；项目运行在 Node 18+ 环境
 * ============================================================
 */

const redis = require('../../config/redis');
const wechatConfig = require('../../config/wechat');
const logger = require('../../utils/logger');

/** 需要刷新 token 的 errcode（企微约定） */
const TOKEN_INVALID_CODES = new Set([40014, 41001, 42001, 42007]);

class WechatApiService {
  constructor() {
    // 进程内兜底缓存（Redis 不可用时用内存）
    this._memCache = { token: null, expireAt: 0 };
  }

  /**
   * 获取 access_token（优先 Redis 缓存）
   *
   * @param {boolean} [forceRefresh=false] 是否强制刷新
   * @returns {Promise<string>}
   */
  async getAccessToken(forceRefresh = false) {
    const conf = wechatConfig.isConfigured();
    if (!conf.ok) {
      throw new Error(`企微配置不完整：缺少 ${conf.missing.join(', ')}`);
    }

    if (!forceRefresh) {
      const cached = await this._getCachedToken();
      if (cached) return cached;
    }

    // 请求新 token
    const url = `${wechatConfig.apiBase}/gettoken?corpid=${wechatConfig.corpId}&corpsecret=${wechatConfig.secret}`;
    const data = await this._httpGet(url);

    if (data.errcode !== 0 || !data.access_token) {
      throw this._buildError('获取 access_token 失败', data);
    }

    await this._setCachedToken(data.access_token, wechatConfig.tokenCacheSeconds);
    logger.info('[WechatApiService] access_token 已刷新');
    return data.access_token;
  }

  /**
   * 通讯录：获取成员详情
   *
   * @param {string} userId 企微 userid
   * @returns {Promise<Object>}
   */
  async getUser(userId) {
    return await this._callWithToken((token) =>
      `${wechatConfig.apiBase}/user/get?access_token=${token}&userid=${encodeURIComponent(userId)}`
    );
  }

  /**
   * 通讯录：按部门拉取成员列表（仅 ID，轻量）
   *
   * @param {number} [departmentId=1] 部门 ID，1 为根部门
   * @param {number} [fetchChild=1]   是否递归子部门
   */
  async listUserIds(departmentId = 1, fetchChild = 1) {
    return await this._callWithToken((token) =>
      `${wechatConfig.apiBase}/user/simplelist?access_token=${token}&department_id=${departmentId}&fetch_child=${fetchChild}`
    );
  }

  /**
   * 审批：按时间范围拉取审批单号列表
   *
   * @param {Object} params
   * @param {number} params.starttime Unix 秒
   * @param {number} params.endtime   Unix 秒
   * @param {number} [params.size=100]
   * @param {Array} [params.filters]
   * @returns {Promise<{sp_no_list: string[]}>}
   */
  async getApprovalInfo(params) {
    const { starttime, endtime, size = 100, filters = [] } = params;
    return await this._callWithToken((token) => ({
      url: `${wechatConfig.apiBase}/oa/getapprovalinfo?access_token=${token}`,
      method: 'POST',
      body: { starttime, endtime, size, filters }
    }));
  }

  /**
   * 审批：获取单个审批详情
   *
   * @param {string} spNo 审批单号
   * @returns {Promise<Object>}
   */
  async getApprovalDetail(spNo) {
    return await this._callWithToken((token) => ({
      url: `${wechatConfig.apiBase}/oa/getapprovaldetail?access_token=${token}`,
      method: 'POST',
      body: { sp_no: spNo }
    }));
  }

  /**
   * 消息：发送应用文本卡片消息
   *
   * @param {Object} params
   * @param {string[]} params.toUser     目标 userid 数组
   * @param {string} params.title
   * @param {string} params.description
   * @param {string} [params.url]        点击跳转 URL
   * @param {string} [params.btntxt='详情']
   */
  async sendTextCard(params) {
    const { toUser, title, description, url, btntxt } = params;
    return await this._callWithToken((token) => ({
      url: `${wechatConfig.apiBase}/message/send?access_token=${token}`,
      method: 'POST',
      body: {
        touser: toUser.join('|'),
        msgtype: 'textcard',
        agentid: parseInt(wechatConfig.agentId, 10),
        textcard: {
          title,
          description,
          url: url || '',
          btntxt: btntxt || '详情'
        }
      }
    }));
  }

  /**
   * 消息：发送纯文本消息
   */
  async sendText(params) {
    const { toUser, content } = params;
    return await this._callWithToken((token) => ({
      url: `${wechatConfig.apiBase}/message/send?access_token=${token}`,
      method: 'POST',
      body: {
        touser: toUser.join('|'),
        msgtype: 'text',
        agentid: parseInt(wechatConfig.agentId, 10),
        text: { content }
      }
    }));
  }

  // ==================== 私有工具 ====================

  /**
   * 【私有】在 access_token 有效期内调用 API，token 失效时自动刷新重试一次
   *
   * @param {(token: string) => string | {url: string, method?: string, body?: any}} urlBuilder
   * @returns {Promise<Object>}
   */
  async _callWithToken(urlBuilder) {
    let token = await this.getAccessToken();
    let result = await this._executeBuilder(urlBuilder, token);

    if (result && TOKEN_INVALID_CODES.has(result.errcode)) {
      logger.warn('[WechatApiService] access_token 失效，强制刷新', { errcode: result.errcode });
      token = await this.getAccessToken(true);
      result = await this._executeBuilder(urlBuilder, token);
    }

    if (result && result.errcode !== 0) {
      throw this._buildError('企微 API 调用失败', result);
    }
    return result;
  }

  async _executeBuilder(urlBuilder, token) {
    const built = urlBuilder(token);
    if (typeof built === 'string') {
      return await this._httpGet(built);
    } else {
      return await this._httpPost(built.url, built.body);
    }
  }

  async _httpGet(url) {
    try {
      const res = await fetch(url, { method: 'GET' });
      return await res.json();
    } catch (error) {
      logger.error('[WechatApiService] GET 请求失败', { url, error: error.message });
      throw error;
    }
  }

  async _httpPost(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      return await res.json();
    } catch (error) {
      logger.error('[WechatApiService] POST 请求失败', { url, error: error.message });
      throw error;
    }
  }

  async _getCachedToken() {
    try {
      if (redis) {
        // ioredis 带 erp: 前缀，这里的 key 写相对路径即可
        const cached = await redis.get('wechat:access_token');
        if (cached) return cached;
      }
    } catch (e) {
      logger.warn('[WechatApiService] Redis 读缓存失败，降级到内存', { error: e.message });
    }
    // 内存兜底
    if (this._memCache.token && this._memCache.expireAt > Date.now()) {
      return this._memCache.token;
    }
    return null;
  }

  async _setCachedToken(token, ttlSeconds) {
    try {
      if (redis) {
        await redis.set('wechat:access_token', token, 'EX', ttlSeconds);
      }
    } catch (e) {
      logger.warn('[WechatApiService] Redis 写缓存失败，降级到内存', { error: e.message });
    }
    this._memCache = {
      token,
      expireAt: Date.now() + ttlSeconds * 1000
    };
  }

  _buildError(prefix, apiResponse) {
    const err = new Error(
      `${prefix}：errcode=${apiResponse?.errcode}, errmsg=${apiResponse?.errmsg}`
    );
    err.errcode = apiResponse?.errcode;
    err.errmsg = apiResponse?.errmsg;
    err.raw = apiResponse;
    return err;
  }
}

module.exports = new WechatApiService();
