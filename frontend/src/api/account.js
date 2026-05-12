import request from './request'

/**
 * 获取账户列表
 * @param {Object} params - 查询参数 { page, pageSize, keyword, status }
 */
export function getAccountList(params) {
  return request.get('/accounts', { params })
}

/**
 * 创建账户
 * @param {Object} data - 账户数据
 */
export function createAccount(data) {
  return request.post('/accounts', data)
}

/**
 * 编辑账户
 * @param {number|string} id - 账户ID
 * @param {Object} data - 账户数据
 */
export function updateAccount(id, data) {
  return request.put(`/accounts/${id}`, data)
}

/**
 * 设置期初余额
 * @param {number|string} id - 账户ID
 * @param {Object} data - { initial_balance }
 */
export function setAccountBalance(id, data) {
  return request.put(`/accounts/${id}/balance`, data)
}

/**
 * 获取账户流水明细
 * @param {number|string} id - 账户ID
 * @param {Object} params - 查询参数 { page, pageSize, start_date, end_date }
 */
export function getAccountFlow(id, params) {
  return request.get(`/accounts/${id}/flow`, { params })
}

/**
 * 账户间转账
 * @param {Object} data - { from_account_id, to_account_id, amount, remark }
 */
export function accountTransfer(data) {
  return request.post('/accounts/transfer', data)
}

/**
 * 获取所有启用的账户（用于下拉选择）
 */
export function getActiveAccounts() {
  return request.get('/accounts', { params: { status: 1, pageSize: 100 } })
}
