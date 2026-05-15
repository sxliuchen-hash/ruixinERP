/**
 * 薪资规则配置接口
 */
import request from './request'

/** 获取所有规则 */
export function getAllSalaryRules() {
  return request.get('/salary-rules')
}

/** 获取指定类型规则 */
export function getSalaryRule(type) {
  return request.get(`/salary-rules/${type}`)
}

/** 初始化默认规则 */
export function initSalaryRules() {
  return request.post('/salary-rules/init')
}

/** 更新规则 */
export function updateSalaryRule(type, data) {
  return request.put(`/salary-rules/${type}`, data)
}

/** 重置规则为默认值 */
export function resetSalaryRule(type) {
  return request.post(`/salary-rules/${type}/reset`)
}
