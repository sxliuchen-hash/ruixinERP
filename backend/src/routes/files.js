/**
 * ============================================================
 * 文件代理下载路由
 * ============================================================
 * 路由前缀：/api/v1/files
 *
 * 通过后端代理从 COS 下载文件，避免直接暴露 COS URL。
 * 需要登录才能访问。
 *
 * 接口：
 *   GET /files/download?key=erp-files/contracts/xxx/file.bin
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const COS = require('cos-nodejs-sdk-v5');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');

router.use((req, res, next) => {
  // 支持 URL 参数传 token（用于文件预览/下载的新窗口场景）
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});
router.use(authenticate);
router.use(requireErpAccess());

/**
 * GET /files/download?key=xxx&preview=1
 * preview=1 时在浏览器内预览（inline），否则触发下载（attachment）
 */
router.get('/download', async (req, res, next) => {
  try {
    const { key, preview } = req.query;
    if (!key) {
      return res.status(400).json({ message: '缺少 key 参数' });
    }

    // 安全检查：只允许下载 erp-files/ 目录下的文件
    if (!key.startsWith('erp-files/')) {
      return res.status(403).json({ message: '无权访问该文件' });
    }

    const cos = new COS({
      SecretId: process.env.COS_SECRET_ID,
      SecretKey: process.env.COS_SECRET_KEY
    });

    // 从 COS 获取文件
    cos.getObject({
      Bucket: process.env.COS_BUCKET,
      Region: process.env.COS_REGION,
      Key: key
    }, (err, data) => {
      if (err) {
        return res.status(404).json({ message: '文件不存在' });
      }

      // 根据文件头判断类型
      const buffer = data.Body;
      const contentType = detectContentType(buffer, key);
      const filename = key.split('/').pop();

      res.setHeader('Content-Type', contentType);
      if (preview === '1' && (contentType.includes('pdf') || contentType.includes('image'))) {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      }
      res.end(buffer);
    });
  } catch (e) {
    next(e);
  }
});

/**
 * 根据文件头 magic bytes 判断 Content-Type
 */
function detectContentType(buffer, filename) {
  if (!buffer || buffer.length < 4) return 'application/octet-stream';

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // ZIP/DOCX/XLSX: 50 4B 03 04
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    if (filename.includes('.docx') || filename.includes('.doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (filename.includes('.xlsx') || filename.includes('.xls')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  return 'application/octet-stream';
}

module.exports = router;
