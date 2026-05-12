/**
 * ============================================================
 * 历史数据导入 Controller
 * ============================================================
 * 接口：
 *   GET  /import/template/:type   下载导入模板
 *   POST /import/validate/:type   上传 Excel 预览校验
 *   POST /import/execute/:type    确认导入（事务批量写入）
 *
 * 【流程】
 *   1. 用户下载模板 → 填写数据
 *   2. 上传 Excel → 后端解析校验 → 返回 valid/errors 预览
 *   3. 用户确认 → 后端事务批量写入 → 返回导入结果
 * ============================================================
 */

const importService = require('../services/importService');
const { sendExcel } = require('../utils/excelHelper');

/**
 * 下载导入模板
 * GET /import/template/:type
 */
async function downloadTemplate(req, res, next) {
  try {
    const { type } = req.params;
    const { buffer, filename } = await importService.generateTemplate(type);
    sendExcel(res, buffer, filename);
  } catch (e) {
    next(e);
  }
}

/**
 * 上传 Excel 预览校验
 * POST /import/validate/:type
 * Body: multipart/form-data (file)
 */
async function validateFile(req, res, next) {
  try {
    const { type } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ message: '请上传 Excel 文件' });
    }

    const result = await importService.parseAndValidate(type, req.file.buffer, userId);
    res.json({
      message: '校验完成',
      data: {
        total: result.total,
        validCount: result.valid.length,
        errorCount: result.errors.length,
        valid: result.valid,
        errors: result.errors
      }
    });
  } catch (e) {
    next(e);
  }
}

/**
 * 确认导入（事务批量写入）
 * POST /import/execute/:type
 * Body: { validRows: [...] }  来自 validate 接口返回的 valid 数组
 */
async function executeImport(req, res, next) {
  try {
    const { type } = req.params;
    const userId = req.user.id;
    const { validRows } = req.body;

    if (!validRows || !Array.isArray(validRows) || validRows.length === 0) {
      return res.status(400).json({ message: '没有可导入的数据' });
    }

    const result = await importService.batchImport(type, validRows, userId);
    res.json({
      message: `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`,
      data: result
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  downloadTemplate,
  validateFile,
  executeImport
};
