/**
 * 银行对账接口封装
 *
 * 后端前缀：/api/v1/reconciliation
 */
import request from './request'

/**
 * 上传 Excel（multipart）
 * @param {FormData} formData 需包含 file、account_id、columnMap、headerRow?、sheetName?
 */
export function uploadStatement(formData) {
  return request.post('/reconciliation/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/** 对账结果 */
export function getReconciliationResult(batchNo) {
  return request.get(`/reconciliation/result/${batchNo}`)
}

/** 对账历史 */
export function getReconciliationHistory(params) {
  return request.get('/reconciliation/history', { params })
}

/** 删除批次 */
export function deleteReconciliationBatch(batchNo) {
  return request.delete(`/reconciliation/batch/${batchNo}`)
}

/**
 * 从流水创建付款
 * @param {number} statementId
 * @param {{category?, contract_id?, customer_id?, supplier_id?, cost_category_id?, project_id?, summary?, remark?}} data
 */
export function createPaymentFromStatement(statementId, data) {
  return request.post(`/reconciliation/statements/${statementId}/create-payment`, data)
}

/** 手动匹配 */
export function matchStatement(statementId, paymentId) {
  return request.put(`/reconciliation/statements/${statementId}/match`, { payment_id: paymentId })
}

/** 解除匹配 */
export function unmatchStatement(statementId) {
  return request.put(`/reconciliation/statements/${statementId}/unmatch`)
}

/** 忽略流水 */
export function ignoreStatement(statementId) {
  return request.put(`/reconciliation/statements/${statementId}/ignore`)
}
