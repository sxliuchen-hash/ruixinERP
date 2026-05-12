import request from './request'

/**
 * 获取客户列表
 * @param {Object} params - 查询参数 { page, pageSize, keyword }
 */
export function getCustomerList(params) {
  return request.get('/customers', { params })
}

/**
 * 创建客户
 * @param {Object} data - 客户数据
 */
export function createCustomer(data) {
  return request.post('/customers', data)
}

/**
 * 编辑客户
 * @param {number|string} id - 客户ID
 * @param {Object} data - 客户数据
 */
export function updateCustomer(id, data) {
  return request.put(`/customers/${id}`, data)
}

/**
 * 删除客户
 * @param {number|string} id - 客户ID
 */
export function deleteCustomer(id) {
  return request.delete(`/customers/${id}`)
}

/**
 * 获取客户往来账汇总
 * @param {number|string} id - 客户ID
 */
export function getCustomerSummary(id) {
  return request.get(`/customers/${id}/summary`)
}

/**
 * 获取所有客户（用于下拉选择）
 */
export function getActiveCustomers() {
  return request.get('/customers', { params: { pageSize: 200 } })
}
