import request from './request'

/**
 * 获取合同列表
 * @param {Object} params - 查询参数 { page, pageSize, keyword, type, status }
 */
export function getContractList(params) {
  return request.get('/contracts', { params })
}

/**
 * 获取合同详情
 * @param {number|string} id - 合同ID
 */
export function getContractDetail(id) {
  return request.get(`/contracts/${id}`)
}

/**
 * 创建合同
 * @param {Object} data - 合同数据
 */
export function createContract(data) {
  return request.post('/contracts', data)
}

/**
 * 编辑合同
 * @param {number|string} id - 合同ID
 * @param {Object} data - 合同数据
 */
export function updateContract(id, data) {
  return request.put(`/contracts/${id}`, data)
}

/**
 * 删除合同
 * @param {number|string} id - 合同ID
 */
export function deleteContract(id) {
  return request.delete(`/contracts/${id}`)
}

/**
 * 更新合同状态
 * @param {number|string} id - 合同ID
 * @param {Object} data - { status }
 */
export function updateContractStatus(id, data) {
  return request.put(`/contracts/${id}/status`, data)
}

/**
 * 确认合同
 * @param {number|string} id - 合同ID
 */
export function confirmContract(id) {
  return request.put(`/contracts/${id}/confirm`)
}

/**
 * 上传合同附件
 * @param {number|string} id - 合同ID
 * @param {FormData} formData - 包含文件的 FormData
 */
export function uploadContractAttachment(id, formData) {
  return request.post(`/contracts/${id}/attachment`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/**
 * 获取活跃合同列表（用于下拉选择）
 * @param {Object} params - 额外查询参数
 */
export function getActiveContracts(params) {
  return request.get('/contracts', { params: { status: 'active', pageSize: 200, ...params } })
}
