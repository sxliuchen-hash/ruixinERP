/**
 * ============================================================
 * 银行对账 Controller
 * ============================================================
 */

const reconciliationService = require('../services/reconciliationService');
const { ValidationError } = require('../utils/errors');

/**
 * POST /api/v1/reconciliation/upload
 * multipart/form-data:
 *   - file      Excel 文件
 *   - account_id 对账账户
 *   - columnMap  JSON 字符串的列映射
 *   - headerRow  表头行号（默认 1）
 *   - sheetName  工作表名（可选）
 */
async function upload(req, res, next) {
  try {
    if (!req.file) throw new ValidationError('未上传文件');

    const account_id = parseInt(req.body.account_id, 10);
    let columnMap;
    try {
      columnMap = typeof req.body.columnMap === 'string'
        ? JSON.parse(req.body.columnMap)
        : req.body.columnMap;
    } catch (e) {
      throw new ValidationError('columnMap 必须为合法 JSON');
    }

    const headerRow = req.body.headerRow ? parseInt(req.body.headerRow, 10) : 1;
    const sheetName = req.body.sheetName || null;

    const result = await reconciliationService.uploadStatement(
      req.file.buffer,
      { account_id, columnMap, headerRow, sheetName },
      req.user.id
    );
    res.json({
      success: true,
      message: `已导入 ${result.total} 条流水，自动匹配 ${result.auto_matched} 条`,
      data: result
    });
  } catch (e) { next(e); }
}

/** GET /api/v1/reconciliation/result/:batchNo - 对账结果 */
async function getResult(req, res, next) {
  try {
    const { batchNo } = req.params;
    const data = await reconciliationService.getResult(batchNo);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

/** GET /api/v1/reconciliation/history - 对账历史 */
async function getHistory(req, res, next) {
  try {
    const data = await reconciliationService.getHistory(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

/** POST /api/v1/reconciliation/statements/:id/create-payment */
async function createPaymentFromStatement(req, res, next) {
  try {
    const { id } = req.params;
    const data = await reconciliationService.createPaymentFromStatement(
      parseInt(id, 10),
      req.body || {},
      req.user.id
    );
    res.json({ success: true, message: '付款记录已创建，流水已匹配', data });
  } catch (e) { next(e); }
}

/** PUT /api/v1/reconciliation/statements/:id/match - 手动匹配 */
async function manualMatch(req, res, next) {
  try {
    const { id } = req.params;
    const { payment_id } = req.body;
    if (!payment_id) throw new ValidationError('payment_id 不能为空');
    const data = await reconciliationService.manualMatch(parseInt(id, 10), parseInt(payment_id, 10));
    res.json({ success: true, message: '匹配成功', data });
  } catch (e) { next(e); }
}

/** PUT /api/v1/reconciliation/statements/:id/unmatch */
async function unmatch(req, res, next) {
  try {
    const { id } = req.params;
    const data = await reconciliationService.unmatch(parseInt(id, 10));
    res.json({ success: true, message: '已解除匹配', data });
  } catch (e) { next(e); }
}

/** PUT /api/v1/reconciliation/statements/:id/ignore */
async function ignore(req, res, next) {
  try {
    const { id } = req.params;
    const data = await reconciliationService.ignore(parseInt(id, 10));
    res.json({ success: true, message: '已忽略', data });
  } catch (e) { next(e); }
}

/** DELETE /api/v1/reconciliation/batch/:batchNo */
async function deleteBatch(req, res, next) {
  try {
    const { batchNo } = req.params;
    const data = await reconciliationService.deleteBatch(batchNo);
    res.json({ success: true, message: `已删除 ${data.deleted} 条流水`, data });
  } catch (e) { next(e); }
}

module.exports = {
  upload,
  getResult,
  getHistory,
  createPaymentFromStatement,
  manualMatch,
  unmatch,
  ignore,
  deleteBatch
};
