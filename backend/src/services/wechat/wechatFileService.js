/**
 * ============================================================
 * 企微附件同步服务（WechatFileService）
 * ============================================================
 * 职责：
 *   1) 从审批详情中提取 file_id 列表
 *   2) 通过企微 media/get 接口下载文件
 *   3) 上传到腾讯云 COS，生成永久 URL
 *   4) 将 COS URL 关联到合同/付款记录
 *
 * 【COS 存储路径规则】
 *   erp-files/contracts/{sp_no}/{字段名}_{序号}.{ext}
 *   erp-files/payments/{sp_no}/{字段名}_{序号}.{ext}
 *
 * 【文件类型推断】
 *   企微 media/get 返回 Content-Type，据此推断扩展名
 * ============================================================
 */

const COS = require('cos-nodejs-sdk-v5');
const wechatApiService = require('./wechatApiService');
const logger = require('../../utils/logger');

// MIME → 扩展名映射
const MIME_EXT_MAP = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/octet-stream': '.bin'
};

class WechatFileService {
  constructor() {
    this._cos = null;
  }

  /**
   * 获取 COS 实例（懒加载）
   */
  _getCos() {
    if (!this._cos) {
      const { COS_SECRET_ID, COS_SECRET_KEY } = process.env;
      if (!COS_SECRET_ID || !COS_SECRET_KEY) {
        throw new Error('COS 配置不完整，请检查 .env');
      }
      this._cos = new COS({ SecretId: COS_SECRET_ID, SecretKey: COS_SECRET_KEY });
    }
    return this._cos;
  }

  /**
   * 从审批详情中提取所有附件信息
   * @param {Object} applyData - 审批的 apply_data
   * @returns {Array<{field: string, file_id: string}>}
   */
  extractFiles(applyData) {
    const files = [];
    if (!applyData || !applyData.contents) return files;

    for (const item of applyData.contents) {
      const titleObj = item.title?.find(t => t.lang === 'zh_CN');
      const fieldName = titleObj ? titleObj.text : item.id;

      if (item.value && item.value.files && item.value.files.length > 0) {
        item.value.files.forEach((f, idx) => {
          files.push({
            field: fieldName,
            file_id: f.file_id,
            index: idx
          });
        });
      }
    }
    return files;
  }

  /**
   * 下载企微文件并上传到 COS
   * @param {string} fileId - 企微 media_id / file_id
   * @param {string} cosKey - COS 存储路径
   * @returns {Promise<{url: string, size: number}>}
   */
  async downloadAndUpload(fileId, cosKey) {
    const token = await wechatApiService.getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${fileId}`;

    // 下载文件
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`下载失败: HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';

    // 如果返回 JSON 说明是错误
    if (contentType.includes('json')) {
      const err = await res.json();
      throw new Error(`企微下载失败: ${err.errmsg || JSON.stringify(err)}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const size = buffer.length;

    // 推断扩展名并修正 cosKey
    const ext = MIME_EXT_MAP[contentType] || '.bin';
    const finalKey = cosKey.endsWith('.bin') ? cosKey.replace('.bin', ext) : cosKey;

    // 上传到 COS
    const cosUrl = await this._uploadToCos(buffer, finalKey, contentType);

    return { url: cosUrl, size, key: finalKey };
  }

  /**
   * 批量同步一个审批单的所有附件
   * @param {string} spNo - 审批单号
   * @param {string} type - 'contracts' 或 'payments'
   * @param {Object} applyData - 审批的 apply_data
   * @returns {Promise<Array<{field, url, size}>>}
   */
  async syncApprovalFiles(spNo, type, applyData) {
    const files = this.extractFiles(applyData);
    if (files.length === 0) return [];

    const results = [];
    for (const file of files) {
      try {
        // 生成 COS 路径：erp-files/{type}/{sp_no}/{field}_{index}.bin
        const safeField = file.field.replace(/[/\\:*?"<>|]/g, '_');
        const cosKey = `erp-files/${type}/${spNo}/${safeField}_${file.index}.bin`;

        const result = await this.downloadAndUpload(file.file_id, cosKey);
        results.push({
          field: file.field,
          file_id: file.file_id,
          url: result.url,
          size: result.size,
          key: result.key
        });

        logger.debug(`[WechatFile] ${spNo} ${file.field} 上传成功: ${result.key}`);
      } catch (e) {
        logger.warn(`[WechatFile] ${spNo} ${file.field} 失败: ${e.message}`);
        results.push({
          field: file.field,
          file_id: file.file_id,
          url: null,
          error: e.message
        });
      }

      // 控制频率
      await new Promise(r => setTimeout(r, 500));
    }

    return results;
  }

  /**
   * 上传 Buffer 到 COS
   */
  _uploadToCos(buffer, key, contentType) {
    const cos = this._getCos();
    const bucket = process.env.COS_BUCKET;
    const region = process.env.COS_REGION;

    return new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: bucket,
        Region: region,
        Key: key,
        Body: buffer,
        ContentType: contentType
      }, (err, data) => {
        if (err) reject(err);
        else resolve(`https://${bucket}.cos.${region}.myqcloud.com/${key}`);
      });
    });
  }
}

module.exports = new WechatFileService();
