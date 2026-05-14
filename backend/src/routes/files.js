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

router.use(authenticate);
router.use(requireErpAccess());

/**
 * GET /files/download?key=xxx
 * 生成 COS 临时签名 URL 并重定向（有效期 10 分钟）
 */
router.get('/download', async (req, res, next) => {
  try {
    const { key } = req.query;
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

    const signedUrl = cos.getObjectUrl({
      Bucket: process.env.COS_BUCKET,
      Region: process.env.COS_REGION,
      Key: key,
      Sign: true,
      Expires: 600 // 10 分钟有效
    });

    // 重定向到签名 URL
    res.redirect(signedUrl);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
