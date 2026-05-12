/**
 * ============================================================
 * 企业微信配置
 * ============================================================
 * 所有企微相关服务从这里读取配置，便于集中管理。
 *
 * 【必填项】
 *   corpId          ：企业 ID（企业信息页底部）
 *   agentId         ：审批应用 ID
 *   secret          ：审批应用 Secret（43 位）
 *   token           ：回调 Token（自定义）
 *   encodingAESKey  ：回调 EncodingAESKey（43 位）
 *
 * 【审批模板映射】
 *   通过环境变量配置各类型审批的 template_id。
 *   T10 的 WechatTemplateMapping 表存数据库，
 *   这里只是提供"默认类型 → template_id"的便捷查询。
 *
 * 【isConfigured 助手】
 *   检查核心配置是否都已填入，未填则相关服务 "优雅降级"（日志警告但不崩溃）。
 * ============================================================
 */

const config = {
  // 基础
  corpId: process.env.WECHAT_CORP_ID || '',
  agentId: process.env.WECHAT_AGENT_ID || '',
  secret: process.env.WECHAT_SECRET || '',

  // 回调
  token: process.env.WECHAT_TOKEN || '',
  encodingAESKey: process.env.WECHAT_AES_KEY || '',

  // 审批模板 ID（T10 使用，空值表示未配置）
  templates: {
    contract: process.env.WECHAT_TEMPLATE_CONTRACT || '',
    expense: process.env.WECHAT_TEMPLATE_EXPENSE || '',
    loan: process.env.WECHAT_TEMPLATE_LOAN || '',
    payment: process.env.WECHAT_TEMPLATE_PAYMENT || ''
  },

  // API 基础 URL
  apiBase: 'https://qyapi.weixin.qq.com/cgi-bin',

  // access_token 缓存时长（秒），企微默认 2 小时，留 100 秒冗余
  tokenCacheSeconds: 7100,

  // Redis 缓存 key
  accessTokenKey: 'erp:wechat:access_token'
};

/**
 * 检查关键配置是否齐全
 *
 * @returns {{ok: boolean, missing: string[]}}
 */
function isConfigured() {
  const missing = [];
  if (!config.corpId) missing.push('WECHAT_CORP_ID');
  if (!config.agentId) missing.push('WECHAT_AGENT_ID');
  if (!config.secret) missing.push('WECHAT_SECRET');
  return { ok: missing.length === 0, missing };
}

/**
 * 检查回调配置是否齐全
 */
function isCallbackConfigured() {
  const missing = [];
  if (!config.token) missing.push('WECHAT_TOKEN');
  if (!config.encodingAESKey) missing.push('WECHAT_AES_KEY');
  if (config.encodingAESKey && config.encodingAESKey.length !== 43) {
    missing.push('WECHAT_AES_KEY (长度应为 43)');
  }
  return { ok: missing.length === 0, missing };
}

module.exports = Object.assign(config, { isConfigured, isCallbackConfigured });
