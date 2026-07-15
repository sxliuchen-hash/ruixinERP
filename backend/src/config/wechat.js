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

function readAliasList(envName, defaults) {
  const configured = String(process.env[envName] || '').trim();
  const values = configured ? configured.split(',') : defaults;
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

const SUPPORTED_TEMPLATE_HANDLERS = Object.freeze({
  contract: 'syncContract',
  payment: 'syncPayment',
  expense: 'syncExpense'
});

const UNBOUND_APPROVAL_POLICIES = Object.freeze([
  'reject',
  'allow_unowned'
]);

function resolveUnboundApprovalPolicy(rawValue = process.env.WECHAT_UNBOUND_APPROVAL_POLICY) {
  const configured = String(rawValue || '').trim().toLowerCase();
  if (!configured) {
    return { policy: 'reject', configured: false, valid: true };
  }
  if (!UNBOUND_APPROVAL_POLICIES.includes(configured)) {
    return { policy: 'reject', configured: true, valid: false };
  }
  return { policy: configured, configured: true, valid: true };
}

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

  expenseFieldAliases: {
    amount: readAliasList('WECHAT_EXPENSE_FIELD_AMOUNT', [
      '报销金额', '报销总金额', '总金额', '费用金额', '金额'
    ]),
    expenseDate: readAliasList('WECHAT_EXPENSE_FIELD_DATE', [
      '费用发生日期', '报销日期', '发生日期', '申请日期'
    ]),
    summary: readAliasList('WECHAT_EXPENSE_FIELD_SUMMARY', [
      '报销事由', '费用说明', '报销说明', '事由', '用途'
    ]),
    category: readAliasList('WECHAT_EXPENSE_FIELD_CATEGORY', [
      '费用类型', '报销类型', '费用类别', '报销类别'
    ]),
    account: readAliasList('WECHAT_EXPENSE_FIELD_ACCOUNT', [
      '付款账户', '支付账户', '报销账户', '付款方式'
    ])
  },

  // API 基础 URL
  apiBase: 'https://qyapi.weixin.qq.com/cgi-bin',

  // access_token 缓存时长（秒），企微默认 2 小时，留 100 秒冗余
  tokenCacheSeconds: 7100,

  // Redis 缓存 key
  accessTokenKey: 'erp:wechat:access_token'
};

function resolveTemplateConfiguration(templates = config.templates) {
  const configuredById = new Map();
  for (const [type, rawTemplateId] of Object.entries(templates || {})) {
    const templateId = String(rawTemplateId || '').trim();
    if (!templateId) continue;
    const types = configuredById.get(templateId) || [];
    types.push(type);
    configuredById.set(templateId, types);
  }

  const handlers = {};
  const duplicates = [];
  const unsupported = [];
  for (const [templateId, types] of configuredById.entries()) {
    if (types.length > 1) {
      duplicates.push({ templateId, types: [...types] });
      continue;
    }
    const type = types[0];
    const handler = SUPPORTED_TEMPLATE_HANDLERS[type];
    if (!handler) {
      unsupported.push({ templateId, type });
      continue;
    }
    handlers[templateId] = handler;
  }

  return { handlers, duplicates, unsupported };
}

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

module.exports = Object.assign(config, {
  isConfigured,
  isCallbackConfigured,
  resolveTemplateConfiguration,
  resolveUnboundApprovalPolicy,
  SUPPORTED_TEMPLATE_HANDLERS,
  UNBOUND_APPROVAL_POLICIES
});
