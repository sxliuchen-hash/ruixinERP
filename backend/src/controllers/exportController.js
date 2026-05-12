/**
 * ============================================================
 * 数据导出 Controller
 * ============================================================
 * 各业务模块的导出接口统一走这里。
 * 参数复用列表接口：前端传什么筛选，导出就用什么筛选。
 *
 * 【响应】
 *   Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   Content-Disposition: attachment; filename="xxx_20260512.xlsx"
 * ============================================================
 */

const exportService = require('../services/exportService');
const { sendExcel } = require('../utils/excelHelper');

async function exportPayments(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const { buffer, filename } = await exportService.exportPayments(req.query, userId, userRole);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportContracts(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const { buffer, filename } = await exportService.exportContracts(req.query, userId, userRole);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportInventory(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const { buffer, filename } = await exportService.exportInventory(req.query, userId, userRole);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportInvoices(req, res, next) {
  try {
    const { buffer, filename } = await exportService.exportInvoices(req.query);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportExpenses(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const { buffer, filename } = await exportService.exportExpenses(req.query, userId, userRole);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportProjects(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const { buffer, filename } = await exportService.exportProjects(req.query, userId, userRole);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

async function exportCosts(req, res, next) {
  try {
    const { buffer, filename } = await exportService.exportCosts(req.query);
    sendExcel(res, buffer, filename);
  } catch (e) { next(e); }
}

module.exports = {
  exportPayments,
  exportContracts,
  exportInventory,
  exportInvoices,
  exportExpenses,
  exportProjects,
  exportCosts
};
