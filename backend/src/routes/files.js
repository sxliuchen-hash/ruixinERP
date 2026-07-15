/**
 * ============================================================
 * 文件代理下载路由
 * ============================================================
 * 路由前缀：/api/v1/files
 *
 * 通过后端代理读取文件（COS erp-files/ 或本地 uploads/），不直接暴露 COS URL。
 *
 * 鉴权方式（下载二选一）：
 *   GET  /files/download?key=...&resourceType=contract&resourceId=... 需 JWT
 *   GET  /files/download?ticket=...            一次性票据（60s、用后即焚），无需 JWT
 *   POST /files/ticket  { key, resourceType, resourceId } 需 JWT，换取一次性下载票据
 *
 * 设计：`<img>` / 新窗口预览无法携带 Authorization 头时，先用 ERP 会话换取
 * 60 秒一次性票据，再用票据下载。URL 中不接受 ERP 长效会话 Token。
 * ============================================================
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const COS = require('cos-nodejs-sdk-v5');
const { authenticate } = require('../middlewares/auth');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { requirePermission } = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const {
  TICKET_TTL,
  createTicket,
  consumeTicket
} = require('../services/fileTicketService');
const {
  normalizeFileKey,
  isAllowedFileKey,
  assertFileResourceAccess
} = require('../services/fileResourceAccessService');
const mainPermissionVersionService = require('../services/mainPermissionVersionService');

// 本地降级附件根目录（与 contractService 降级写入路径一致：backend/uploads）
const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');
const requireFreshPermissions = requireFreshPermissionVersion();
const requireFileDownload = requirePermission(PERMISSIONS.FILE_DOWNLOAD);

/**
 * POST /files/ticket - 换取一次性下载票据（需登录）
 * body: { key, resourceType, resourceId }
 */
router.post(
  '/ticket',
  authenticate,
  requireFreshPermissions,
  requireFileDownload,
  async (req, res, next) => {
    try {
      const { key, resourceType, resourceId } = req.body || {};
      if (!key) return res.status(400).json({ message: '缺少 key 参数' });
      if (!isAllowedFileKey(key)) return res.status(403).json({ message: '无权访问该文件' });

      const access = await assertFileResourceAccess({
        user: req.user,
        resourceType,
        resourceId,
        key
      });

      const ticket = await createTicket({
        ...access,
        userId: req.user.id,
        permissionVersion: req.user.permissionVersion,
        authSource: req.user.authSource
      });
      res.json({ success: true, data: { ticket, expires_in: TICKET_TTL } });
    } catch (e) {
      next(e);
    }
  }
);

/** ticket 或 JWT 二选一：带 ticket 则跳过 JWT（票据本身即凭证），否则走 JWT 鉴权 */
function ticketOrAuth(req, res, next) {
  if (req.query.ticket) return next();
  authenticate(req, res, (err) => {
    if (err) return next(err);
    requireFreshPermissions(req, res, (freshError) => {
      if (freshError) return next(freshError);
      requireFileDownload(req, res, next);
    });
  });
}

/**
 * GET /files/download?key=xxx&resourceType=contract&resourceId=1  或  ?ticket=xxx
 * preview=1 时在浏览器内预览（inline），否则触发下载（attachment）
 */
router.get('/download', ticketOrAuth, async (req, res, next) => {
  try {
    let { key } = req.query;
    const { preview, ticket, resourceType, resourceId } = req.query;

    if (ticket) {
      const ticketPayload = await consumeTicket(ticket);
      if (!ticketPayload) return res.status(403).json({ message: '下载票据无效或已过期' });

      const ticketUser = {
        id: ticketPayload.userId,
        authSource: ticketPayload.authSource,
        permissionVersion: ticketPayload.permissionVersion,
        permissions: {
          [ticketPayload.permissionCode]: {
            allowed: true,
            scope: ticketPayload.permissionScope
          }
        }
      };
      await mainPermissionVersionService.assertCurrentPermissionVersion(ticketUser, {
        forceRefresh: true
      });
      const access = await assertFileResourceAccess({
        user: ticketUser,
        resourceType: ticketPayload.resourceType,
        resourceId: ticketPayload.resourceId,
        key: ticketPayload.key
      });
      key = access.key;
    } else {
      const access = await assertFileResourceAccess({
        user: req.user,
        resourceType,
        resourceId,
        key
      });
      key = access.key;
    }
    if (!key) return res.status(400).json({ message: '缺少 key 参数' });

    return await serveByKey(key, preview, res);
  } catch (e) {
    next(e);
  }
});

/** 按 key 提供文件：本地 uploads/ 走文件系统，erp-files/ 走 COS */
async function serveByKey(key, preview, res) {
  const normalizedKey = normalizeFileKey(key);

  // 本地降级附件
  if (normalizedKey.startsWith('uploads/')) {
    return serveLocalFile(normalizedKey, preview, res);
  }

  // COS 文件：仅允许 erp-files/ 前缀
  if (!normalizedKey.startsWith('erp-files/') && !normalizedKey.startsWith('erp/contracts/')) {
    return res.status(403).json({ message: '无权访问该文件' });
  }

  const cos = new COS({
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY
  });

  cos.getObject({
    Bucket: process.env.COS_BUCKET,
    Region: process.env.COS_REGION,
    Key: normalizedKey
  }, (err, data) => {
    if (err) {
      return res.status(404).json({ message: '文件不存在' });
    }
    const buffer = data.Body;
    const contentType = detectContentType(buffer, normalizedKey);
    const filename = normalizedKey.split('/').pop();
    res.setHeader('Content-Type', contentType);
    if (preview === '1' && (contentType.includes('pdf') || contentType.includes('image'))) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    }
    res.end(buffer);
  });
}

/**
 * 读取本地 uploads 文件并响应（已通过 ticket/JWT 鉴权），带路径穿越防护
 */
function serveLocalFile(normalizedKey, preview, res) {
  const relative = normalizedKey.slice('uploads/'.length);
  const target = path.resolve(UPLOADS_ROOT, relative);

  // 防路径穿越：目标必须位于 uploads 根目录内
  if (target !== UPLOADS_ROOT && !target.startsWith(UPLOADS_ROOT + path.sep)) {
    return res.status(403).json({ message: '无权访问该文件' });
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).json({ message: '文件不存在' });
  }

  const buffer = fs.readFileSync(target);
  const contentType = detectContentType(buffer, target);
  const filename = path.basename(target);
  res.setHeader('Content-Type', contentType);
  if (preview === '1' && (contentType.includes('pdf') || contentType.includes('image'))) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  }
  return res.end(buffer);
}

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
