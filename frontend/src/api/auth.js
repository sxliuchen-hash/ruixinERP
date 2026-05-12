import request from './request'

/**
 * 登录
 * @param {Object} data - { username, password }
 */
export function login(data) {
  return request.post('/auth/login', data)
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
  return request.post('/auth/logout')
}
