/**
 * 借款管理接口封装
 *
 * 后端前缀：/api/v1/loans
 * 权限：authenticate + requireErpAccess + attachDataFilter
 */
import request from './request'

/**
 * 借款列表（分页 + 筛选）
 * 支持筛选：user_id, status (unpaid/partial/paid), account_id,
 *           start_date, end_date, keyword
 */
export function getLoanList(params) {
  return request.get('/loans', { params })
}

/** 详情（含还款明细） */
export function getLoanDetail(id) {
  return request.get(`/loans/${id}`)
}

/** 创建 */
export function createLoan(data) {
  return request.post('/loans', data)
}

/** 更新（不包含 repaid_amount / status，这两个由系统维护） */
export function updateLoan(id, data) {
  return request.put(`/loans/${id}`, data)
}

/** 删除（级联删除还款记录） */
export function deleteLoan(id) {
  return request.delete(`/loans/${id}`)
}

/**
 * 新增还款记录
 * @param {number} id 借款单 ID
 * @param {{amount, repay_date, account_id?, remark?}} data
 */
export function addRepayment(id, data) {
  return request.post(`/loans/${id}/repayments`, data)
}

/**
 * 删除还款记录
 */
export function deleteRepayment(id, repaymentId) {
  return request.delete(`/loans/${id}/repayments/${repaymentId}`)
}

/**
 * 借款概况（分状态汇总 + 总计）
 * @param {{user_id?: number}} params
 */
export function getLoanSummary(params) {
  return request.get('/loans/summary', { params })
}
