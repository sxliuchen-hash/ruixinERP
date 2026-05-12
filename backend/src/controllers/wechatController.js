/**
 * ============================================================
 * 企业微信 Controller
 * ============================================================
 *
 * 【提供接口】
 *   GET  /api/v1/wechat/callback   回调 URL 验证（企微后台配置时触发）
 *   POST /api/v1/wechat/callback   接收审批事件
 *   GET  /api/v1/wechat/config     检查企微配置状态（admin only）
 *   GET  /api/v1/wechat/test-token 测试获取 access_token（admin only）
 *   GET  /api/v1/wechat/users/:userId  查询企微成员信息（admin only）
 *
 * 【回调 XML 格式】
 *   POST body:
 *   <xml>
 *     <ToUserName><![CDATA[wwed291a8364287ea4]]></ToUserName>
 *     <Encrypt><![CDATA[...]]></Encrypt>
 *   </xml>
 *
 *   query: ?msg_signature=xx&timestamp=xx&nonce=xx
 * ============================================================
 */

const wechatCryptoService = require('../services/wechat/wechatCryptoService');
const wechatApiService = require('../services/wechat/wechatApiService');
const wechatConfig = require('../config/wechat');
const logger = require('../utils/logger');

/** 从 XML 中提取 Encrypt 字段的粗解析（不依赖 XML 库） */
function parseEncryptFromXml(xml) {
  if (!xml) return null;
  const m = xml.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/);
  return m ? m[1] : null;
}

/**
 * GET /api/v1/wechat/callback
 * 企微后台配置回调 URL 时的验证
 *
 * 响应明文 echostr 即通过验证。
 */
async function verifyCallback(req, res, next) {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return res.status(400).send('缺少必填参数');
    }

    const plain = wechatCryptoService.verifyURL(msg_signature, timestamp, nonce, echostr);
    logger.info('[Wechat Callback] URL 验证通过');
    res.type('text/plain').send(plain);
  } catch (error) {
    logger.error('[Wechat Callback] URL 验证失败', { error: error.message });
    res.status(403).send('验证失败: ' + error.message);
  }
}

/**
 * POST /api/v1/wechat/callback
 * 接收企微推送的事件（审批变更、成员变更等）
 *
 * 【当前实现】
 *   T9 阶段：解密后仅记录日志，不做业务处理
 *   T10 会在此基础上接入审批同步：
 *     - 解析 EventType / ChangeType
 *     - 若 ChangeType = 'open_approval_change' → 提取 sp_no → 调用 wechatSyncService.syncBySpNo
 *
 * 企微要求 5 秒内响应，且响应 "success" 字符串（或加密后的响应 XML）
 */
async function receiveCallback(req, res, next) {
  try {
    const { msg_signature, timestamp, nonce } = req.query;

    // 企微的 Content-Type 是 text/xml，body 取决于前置 parser
    const rawBody = typeof req.body === 'string' ? req.body
      : (req.body && req.body._raw) || '';
    const encrypt = parseEncryptFromXml(rawBody);

    if (!encrypt) {
      logger.warn('[Wechat Callback] XML 中未找到 Encrypt 字段', {
        bodyPreview: String(rawBody).slice(0, 200)
      });
      return res.type('text/plain').send('success'); // 即使解析失败也响应 success 避免重试轰炸
    }

    // 校验签名
    if (!wechatCryptoService.verifySignature(msg_signature, timestamp, nonce, encrypt)) {
      logger.error('[Wechat Callback] 签名校验失败');
      return res.status(403).send('signature invalid');
    }

    // 解密
    const { message } = wechatCryptoService.decrypt(encrypt);
    logger.info('[Wechat Callback] 事件已接收', {
      messagePreview: message.slice(0, 500)
    });

    // T10 会把事件分发到 wechatSyncService，这里先占位
    // const handlerResult = await require('../services/wechat/wechatSyncService').handleCallback(message);

    res.type('text/plain').send('success');
  } catch (error) {
    logger.error('[Wechat Callback] 处理失败', { error: error.message, stack: error.stack });
    // 即使出错也响应 success，防止企微重试；错误已记日志
    res.type('text/plain').send('success');
  }
}

/**
 * GET /api/v1/wechat/config - 检查企微配置（admin）
 */
async function getConfigStatus(req, res, next) {
  try {
    const base = wechatConfig.isConfigured();
    const callback = wechatConfig.isCallbackConfigured();
    res.json({
      success: true,
      data: {
        corp_id: wechatConfig.corpId ? wechatConfig.corpId : '',
        agent_id: wechatConfig.agentId ? '已配置' : '',
        base_ready: base.ok,
        base_missing: base.missing,
        callback_ready: callback.ok,
        callback_missing: callback.missing,
        templates: wechatConfig.templates,
        // 不泄漏敏感值
        secret_configured: !!wechatConfig.secret,
        token_configured: !!wechatConfig.token,
        aes_key_configured: !!wechatConfig.encodingAESKey
      }
    });
  } catch (e) { next(e); }
}

/**
 * GET /api/v1/wechat/test-token - 测试获取 access_token（admin 诊断用）
 */
async function testToken(req, res, next) {
  try {
    const token = await wechatApiService.getAccessToken(true);
    res.json({
      success: true,
      message: 'access_token 获取成功',
      data: { token_preview: token.slice(0, 16) + '...', length: token.length }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'WECHAT_TOKEN_FAILED',
      message: error.message,
      errcode: error.errcode
    });
  }
}

/**
 * GET /api/v1/wechat/users/:userId - 查询企微成员信息（admin 诊断用）
 */
async function getWechatUser(req, res, next) {
  try {
    const data = await wechatApiService.getUser(req.params.userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'WECHAT_USER_FAILED',
      message: error.message,
      errcode: error.errcode
    });
  }
}

module.exports = {
  verifyCallback,
  receiveCallback,
  getConfigStatus,
  testToken,
  getWechatUser
};
