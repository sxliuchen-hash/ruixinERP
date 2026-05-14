/**
 * 薪资规则配置接口
 */
import request from './request'

/** 获取所有规则（按分类分组） */
export function getSalaryRules() {
  return request.get('/salary-rules')
}

/** 获取单条规则 */
export function getSalaryRule(key) {
  return request.get(`/salary-rules/${key}`)
}

/** 初始化默认规则 */
export function initSalaryRules() {
  return request.post('/salary-rules/init')
}

/** 更新规则 */
export function updateSalaryRule(id, data) {
  return request.put(`/salary-rules/${id}`, data)
}
