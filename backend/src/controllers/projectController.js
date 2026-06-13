/**
 * ============================================================
 * 交易项目 Controller
 * ============================================================
 * 薄层转接，调用 projectService 执行业务。
 * ============================================================
 */

const projectService = require('../services/projectService');

/** GET /api/v1/projects */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await projectService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/projects/summary - 利润总览（Dashboard 升级用） */
async function getSummary(req, res, next) {
  try {
    const data = await projectService.getProfitSummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/projects/:id */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await projectService.getDetail(parseInt(id, 10), userId, userRole);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/projects/:id/profit - 利润明细（Sankey 图数据源） */
async function getProfit(req, res, next) {
  try {
    const { id } = req.params;
    const data = await projectService.getProfitDetail(parseInt(id, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/projects */
async function create(req, res, next) {
  try {
    const data = await projectService.create(req.body, req.user.id);
    res.status(201).json({ success: true, message: '项目创建成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/projects/:id */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await projectService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '项目更新成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/projects/:id/status */
async function changeStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { id: userId, role: userRole } = req.user;
    const data = await projectService.changeStatus(parseInt(id, 10), status, userId, userRole);
    res.json({ success: true, message: '状态已变更', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/projects/:id/refresh - 手动刷新聚合字段 */
async function refresh(req, res, next) {
  try {
    const { id } = req.params;
    const data = await projectService.refreshAggregates(parseInt(id, 10));
    res.json({ success: true, message: '聚合数据已刷新', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/projects/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await projectService.delete(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '项目已删除（关联单据已解除关联但保留）', data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  getSummary,
  getDetail,
  getProfit,
  create,
  update,
  changeStatus,
  refresh,
  remove
};
