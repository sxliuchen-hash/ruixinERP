/**
 * 收付款接口封装
 *
 * 后端前缀：/api/v1/payments
 * 权限：authenticate + requireErpAccess + attachDataFilter
 *       （agent 仅能看/改自己 created_by 的记录）
 */
import request from './request'

/**
 * 收付款列表（分页 + 多维筛选）
 * 支持筛选：type, category, account_id, contract_id, customer_id, supplier_id,
 *           project_id, cost_category_id, confirm_status, sp_no,
 *           start_date, end_date, keyword
 */
export function getPaymentList(params) {
  return request.get('/payments', { params })
}

/** 详情 */
export function getPaymentDetail(id) {
  return request.get(`/payments/${id}`)
}

/** 创建 */
export function createPayment(data) {
  return request.post('/payments', data)
}

/** 更新 */
export function updatePayment(id, data) {
  return request.put(`/payments/${id}`, data)
}

/** 删除 */
export function deletePayment(id) {
  return request.delete(`/payments/${id}`)
}

/** 确认（pending → confirmed） */
export function confirmPayment(id) {
  return request.put(`/payments/${id}/confirm`)
}

/**
 * 应收汇总（基于销售合同）
 * @param {{customer_id?: number}} params
 */
export function getReceivable(params) {
  return request.get('/payments/receivable', { params })
}

/**
 * 应付汇总（基于采购合同）
 * @param {{supplier_id?: number}} params
 */
export function getPayable(params) {
  return request.get('/payments/payable', { params })
}
