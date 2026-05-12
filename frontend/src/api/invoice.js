import request from './request'

/**
 * 获取发票列表
 * @param {Object} params - 查询参数 { page, pageSize, keyword, type, status }
 */
export function getInvoiceList(params) {
  return request.get('/invoices', { params })
}

/**
 * 获取发票详情
 * @param {number|string} id - 发票ID
 */
export function getInvoiceDetail(id) {
  return request.get(`/invoices/${id}`)
}

/**
 * 创建发票
 * @param {Object} data - 发票数据
 */
export function createInvoice(data) {
  return request.post('/invoices', data)
}

/**
 * 编辑发票
 * @param {number|string} id - 发票ID
 * @param {Object} data - 发票数据
 */
export function updateInvoice(id, data) {
  return request.put(`/invoices/${id}`, data)
}

/**
 * 删除发票
 * @param {number|string} id - 发票ID
 */
export function deleteInvoice(id) {
  return request.delete(`/invoices/${id}`)
}

/**
 * 更新发票状态
 * @param {number|string} id - 发票ID
 * @param {Object} data - { status }
 */
export function updateInvoiceStatus(id, data) {
  return request.put(`/invoices/${id}/status`, data)
}
