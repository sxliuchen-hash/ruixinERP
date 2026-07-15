import request from './request'

/**
 * 登录页公开读取后端认证开关。
 */
export function getAuthFeatures() {
  return request.get('/auth/features')
}

/**
 * 创建并通过 HttpOnly Cookie 绑定本次 RP 发起的 SSO state。
 */
export function initiateSso(data = {}) {
  return request.post('/auth/sso/initiate', data, { withCredentials: true })
}

/**
 * 登录
 * @param {Object} data - { username, password }
 */
export function login(data) {
  return request.post('/auth/login', data)
}

/**
 * 使用主项目签发的一次性授权码建立 ERP 会话
 * @param {string} code - 一次性 SSO code
 * @param {string} state - 与当前浏览器 HttpOnly Cookie 绑定的一次性 state
 */
export function exchangeSsoCode(code, state) {
  return request.post('/auth/sso/exchange', { code, state }, { withCredentials: true })
}

/**
 * 获取当前用户信息
 */
export function getProfile() {
  return request.get('/auth/profile')
}

/**
 * 登出
 */
export function logout() {
  return request.post('/auth/logout', undefined, { timeout: 5000 })
}
