/**
 * 系统设置接口封装
 * 后端前缀：/api/v1/system-settings
 */
import request from './request'

/** 获取所有设置 */
export function getSettings(category) {
  return request.get('/system-settings', { params: { category } })
}

/** 获取单个设置值 */
export function getSetting(key) {
  return request.get(`/system-settings/${key}`)
}

/** 更新设置（仅管理员） */
export function updateSetting(key, value, description, category) {
  return request.put(`/system-settings/${key}`, { value, description, category })
}

/** 删除设置（仅管理员） */
export function deleteSetting(key) {
  return request.delete(`/system-settings/${key}`)
}
