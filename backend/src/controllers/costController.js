/**
 * ============================================================
 * 成本管理 Controller
 * ============================================================
 * 包含：
 *   - 成本类别 CRUD + 树形查询
 *   - 成本记录 CRUD
 *   - 月度/大类/细类汇总 + 同比环比
 *   - 固定月费自动生成（管理员手动触发）
 * ============================================================
 */

const costService = require('../services/costService');

// ===== 成本类别 =====

async function getCategoryList(req, res, next) {
  try {
    const data = await costService.getCategoryList(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function getCategoryTree(req, res, next) {
  try {
    const data = await costService.getCategoryTree();
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function createCategory(req, res, next) {
  try {
    const data = await costService.createCategory(req.body);
    res.status(201).json({ success: true, message: '类别创建成功', data });
  } catch (e) { next(e); }
}

async function updateCategory(req, res, next) {
  try {
    const { id } = req.params;
    const data = await costService.updateCategory(parseInt(id, 10), req.body);
    res.json({ success: true, message: '类别更新成功', data });
  } catch (e) { next(e); }
}

async function deleteCategory(req, res, next) {
  try {
    const { id } = req.params;
    const data = await costService.deleteCategory(parseInt(id, 10));
    res.json({ success: true, message: '类别已删除', data });
  } catch (e) { next(e); }
}

// ===== 成本记录 =====

async function getRecordList(req, res, next) {
  try {
    const data = await costService.getRecordList(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function createRecord(req, res, next) {
  try {
    const data = await costService.createRecord(req.body, req.user.id);
    res.status(201).json({ success: true, message: '成本记录创建成功', data });
  } catch (e) { next(e); }
}

async function updateRecord(req, res, next) {
  try {
    const { id } = req.params;
    const data = await costService.updateRecord(parseInt(id, 10), req.body);
    res.json({ success: true, message: '成本记录更新成功', data });
  } catch (e) { next(e); }
}

async function deleteRecord(req, res, next) {
  try {
    const { id } = req.params;
    const data = await costService.deleteRecord(parseInt(id, 10));
    res.json({ success: true, message: '成本记录已删除', data });
  } catch (e) { next(e); }
}

// ===== 汇总分析 =====

async function getMonthlySummary(req, res, next) {
  try {
    const data = await costService.getMonthlySummary(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function getTypeBreakdown(req, res, next) {
  try {
    const data = await costService.getTypeBreakdown(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function getCategoryBreakdown(req, res, next) {
  try {
    const data = await costService.getCategoryBreakdown(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

async function getYoyMom(req, res, next) {
  try {
    const data = await costService.getYoyMom(req.query);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

/** POST /api/v1/costs/recurring/generate - 管理员手动触发固定月费生成 */
async function generateRecurring(req, res, next) {
  try {
    const data = await costService.generateRecurringRecords(req.body?.month);
    res.json({
      success: true,
      message: `固定月费已生成 ${data.generated} 条（${data.month}）`,
      data
    });
  } catch (e) { next(e); }
}

module.exports = {
  getCategoryList,
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  getRecordList,
  createRecord,
  updateRecord,
  deleteRecord,
  getMonthlySummary,
  getTypeBreakdown,
  getCategoryBreakdown,
  getYoyMom,
  generateRecurring
};
