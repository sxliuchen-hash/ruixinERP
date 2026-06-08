/**
 * ============================================================
 * 业绩上传路由
 * ============================================================
 * 路由前缀：/api/v1/performance-import
 * 权限：authenticate + admin（业绩上传/确认仅管理员）
 *
 * 接口：
 *   GET    /template            下载业绩统计表模板
 *   POST   /validate            上传 Excel 预览校验（不入库）
 *   POST   /confirm             确认入库（事务）
 *   GET    /batches             批次列表
 *   GET    /batches/:id         批次明细
 *   DELETE /batches/:id         删除批次（连同明细）
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/permission');
const { operationLog } = require('../middlewares/operationLog');
const { sendExcel } = require('../utils/excelHelper');
const performanceUploadService = require('../services/performanceUploadService');

// multer 内存存储，限制 10MB，仅 Excel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 或 .xls 格式'));
    }
  }
});

router.use(authenticate);
router.use(requireAdmin());

// 下载模板
router.get('/template', async (req, res, next) => {
  try {
    const { buffer, filename } = await performanceUploadService.generateTemplate();
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
});

// 上传预览校验
router.post('/validate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }
    const now = new Date();
    const year = parseInt(req.body.year) || now.getFullYear();
    const month = parseInt(req.body.month) || (now.getMonth() + 1);
    const result = await performanceUploadService.parseAndValidate(req.file.buffer, year, month);
    res.json({ success: true, data: { ...result, file_name: req.file.originalname } });
  } catch (e) { next(e); }
});

// 确认入库
router.post('/confirm', operationLog('create', 'performance_import'), async (req, res, next) => {
  try {
    const { year, month, file_name, records } = req.body;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: '请指定年月' });
    }
    const result = await performanceUploadService.confirmImport({
      year: parseInt(year),
      month: parseInt(month),
      file_name,
      records,
      userId: req.user.id
    });
    res.json({ success: true, data: result, message: `已导入 ${result.record_count} 条业绩` });
  } catch (e) { next(e); }
});

// 批次列表
router.get('/batches', async (req, res, next) => {
  try {
    const data = await performanceUploadService.listBatches(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// 批次明细
router.get('/batches/:id', async (req, res, next) => {
  try {
    const data = await performanceUploadService.getBatchRecords(parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// 删除批次
router.delete('/batches/:id', operationLog('delete', 'performance_import'), async (req, res, next) => {
  try {
    await performanceUploadService.removeBatch(parseInt(req.params.id));
    res.json({ success: true, message: '已删除批次' });
  } catch (e) { next(e); }
});

module.exports = router;
