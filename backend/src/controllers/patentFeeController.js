/**
 * ============================================================
 * 专利年费查询 Controller（代理 IP 系统接口）
 * ============================================================
 * ERP 不直接查询国知局，通过调用 IP 系统 API 获取年费数据。
 * 本 Controller 作为代理层，将 IP 系统数据透传给前端。
 * ============================================================
 */

const ipSystemService = require('../services/ipSystemService');

/**
 * GET /api/v1/patent-fee/detail/:patentNo
 * 获取单个专利的完整年费详情（应缴/已缴/发文/质押/许可/变更）
 */
async function getFeeDetail(req, res, next) {
  try {
    const { patentNo } = req.params;
    const data = await ipSystemService.getPatentFeeDetail(patentNo, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/patent-fee/info/:patentNo
 * 获取专利基本信息（发明人/代理/IPC/授权等）
 */
async function getPatentInfo(req, res, next) {
  try {
    const { patentNo } = req.params;
    const data = await ipSystemService.getPatentInfo(patentNo, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/patent-fee/list
 * 年费列表（分页、筛选）— 代理 IP 系统接口
 */
async function getFeeList(req, res, next) {
  try {
    const data = await ipSystemService.getPatentFeeList(req.query, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/patent-fee/dashboard
 * 年费统计面板
 */
async function getFeeDashboard(req, res, next) {
  try {
    const data = await ipSystemService.getPatentFeeDashboard(req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getFeeDetail,
  getPatentInfo,
  getFeeList,
  getFeeDashboard
};
