/**
 * ============================================================
 * 企业微信消息加解密服务（WechatCryptoService）
 * ============================================================
 *
 * 实现企业微信官方加解密规范：
 *   https://developer.work.weixin.qq.com/document/path/90968
 *
 * 【加解密算法】
 *   - AES-256-CBC
 *   - key = Base64Decode(EncodingAESKey + "=")  (43 位 Base64URL + "=" 得到 44 位，再解 base64 = 32 字节)
 *   - iv  = key 的前 16 字节
 *
 * 【密文结构】
 *   msg_encrypt = Base64(
 *     AES_Encrypt(
 *       random(16) + msg_len(4 大端) + msg + receiveid
 *     )
 *   )
 *
 * 【签名校验】
 *   signature = sha1(sort([token, timestamp, nonce, msg_encrypt]).join(''))
 *
 * 【PKCS#7 Padding】
 *   企微使用 PKCS#7：pad = 32 - (len % 32)
 *
 * 【异常处理】
 *   所有方法在出错时抛出带语义的 Error，由上层统一捕获返回 403
 * ============================================================
 */

const crypto = require('crypto');
const wechatConfig = require('../../config/wechat');

class WechatCryptoService {
  /**
   * SHA1 签名校验
   *
   * @param {string} signature  企微回调的 msg_signature
   * @param {string} timestamp  回调的 timestamp
   * @param {string} nonce      回调的 nonce
   * @param {string} encryptMsg echostr 或 XML 内的 Encrypt
   * @returns {boolean}
   */
  verifySignature(signature, timestamp, nonce, encryptMsg) {
    const token = wechatConfig.token || '';
    const arr = [token, timestamp, nonce, encryptMsg].sort();
    const str = arr.join('');
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    return hash === signature;
  }

  /**
   * 解密企微回调密文
   *
   * @param {string} encryptMsg  Base64 密文
   * @returns {{message: string, receiveId: string}}
   */
  decrypt(encryptMsg) {
    if (!wechatConfig.encodingAESKey) {
      throw new Error('EncodingAESKey 未配置');
    }
    if (wechatConfig.encodingAESKey.length !== 43) {
      throw new Error('EncodingAESKey 长度必须为 43');
    }

    // 企微规范：EncodingAESKey + "=" 是合法 Base64
    const aesKey = Buffer.from(wechatConfig.encodingAESKey + '=', 'base64');
    if (aesKey.length !== 32) {
      throw new Error(`AESKey 解码后长度应为 32，实际为 ${aesKey.length}`);
    }
    const iv = aesKey.slice(0, 16);

    // 解密
    const cipher = Buffer.from(encryptMsg, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(cipher), decipher.final()]);

    // 去除 PKCS#7 padding
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 32) {
      throw new Error('解密后 padding 长度非法');
    }
    decrypted = decrypted.slice(0, decrypted.length - padLen);

    // 拆分：random(16) + msgLen(4) + msg + receiveId
    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.slice(20, 20 + msgLen).toString('utf8');
    const receiveId = decrypted.slice(20 + msgLen).toString('utf8');

    // 校验 receiveId（应等于 CorpID）
    if (wechatConfig.corpId && receiveId !== wechatConfig.corpId) {
      throw new Error(
        `解密后 receiveId=${receiveId} 与 CorpID=${wechatConfig.corpId} 不一致`
      );
    }

    return { message: msg, receiveId };
  }

  /**
   * 加密（主动回复消息使用，T9 一般不用）
   *
   * @param {string} message XML 原文
   * @returns {string} Base64 密文
   */
  encrypt(message) {
    if (!wechatConfig.encodingAESKey || !wechatConfig.corpId) {
      throw new Error('企微配置不完整');
    }
    const aesKey = Buffer.from(wechatConfig.encodingAESKey + '=', 'base64');
    const iv = aesKey.slice(0, 16);

    const random = crypto.randomBytes(16);
    const msgBuf = Buffer.from(message, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    const receiveId = Buffer.from(wechatConfig.corpId, 'utf8');

    const full = Buffer.concat([random, lenBuf, msgBuf, receiveId]);

    // PKCS#7 padding
    const padLen = 32 - (full.length % 32);
    const padded = Buffer.concat([full, Buffer.alloc(padLen, padLen)]);

    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    return encrypted.toString('base64');
  }

  /**
   * 验证 URL（处理回调配置验证的 echostr）
   *
   * 企微后台配置回调时会 GET 回调地址，参数含：
   *   msg_signature, timestamp, nonce, echostr
   * 需要校验签名，然后解密 echostr，将明文返回。
   *
   * @returns {string} 明文 echo string
   */
  verifyURL(signature, timestamp, nonce, echostr) {
    if (!this.verifySignature(signature, timestamp, nonce, echostr)) {
      throw new Error('签名校验失败');
    }
    const { message } = this.decrypt(echostr);
    return message;
  }
}

module.exports = new WechatCryptoService();
