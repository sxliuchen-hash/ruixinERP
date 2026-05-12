import request from './request'

/**
 * 获取供应商列表
 * @param {Object} params - 查询参数 { page, pageSize, keyword }
 */
export function getSupplierList(params) {
  return request.get('/suppliers', { params })
}

/**
 * 创建供应商
 * @param {Object} data - 供应商数据
 */
export function createSupplier(data) {
  return request.post('/suppliers', data)
}

/**
 * 编辑供应商
 * @param {number|string} id - 供应商ID
 * @param {Object} data - 供应商数据
 */
export function updateSupplier(id, data) {
  return request.put(`/suppliers/${id}`, data)
}

/**
 * 删除供应商
 * @param {number|string} id - 供应商ID
 */
export function deleteSupplier(id) {
  return request.delete(`/suppliers/${id}`)
}

/**
 * 获取供应商往来账汇总
 * @param {number|string} id - 供应商ID
 */
export function getSupplierSummary(id) {
  return request.get(`/suppliers/${id}/summary`)
}

/**
 * 获取所有供应商（用于下拉选择）
 */
export function getActiveSuppliers() {
  return request.get('/suppliers', { params: { pageSize: 200 } })
}
