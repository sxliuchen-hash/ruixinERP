/**
 * 工资条接口
 */
import request from './request'

/** 生成工资条 */
export function generatePayroll(data) {
  return request.post('/payroll/generate', data)
}

/** 查询工资条列表 */
export function getPayrollList(params) {
  return request.get('/payroll', { params })
}

/** 月度汇总 */
export function getPayrollSummary(params) {
  return request.get('/payroll/summary', { params })
}

/** 编辑工资条 */
export function updatePayroll(id, data) {
  return request.put(`/payroll/${id}`, data)
}

/** 重新计算 */
export function recalculatePayroll(id) {
  return request.post(`/payroll/${id}/recalculate`)
}

/** 确认工资条 */
export function confirmPayroll(id) {
  return request.post(`/payroll/${id}/confirm`)
}

/** 批量确认 */
export function confirmPayrollBatch(data) {
  return request.post('/payroll/confirm-batch', data)
}

/** 标记已发放 */
export function markPayrollPaid(id) {
  return request.post(`/payroll/${id}/paid`)
}

/** 删除工资条 */
export function deletePayroll(id) {
  return request.delete(`/payroll/${id}`)
}
