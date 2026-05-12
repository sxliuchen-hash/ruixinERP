/**
 * 交易项目管理接口封装
 *
 * 后端前缀：/api/v1/projects
 * 权限：authenticate + requireErpAccess + attachDataFilter
 *       （agent 仅可见 created_by=自己 OR owner_id=自己 的项目）
 */
import request from './request'

/**
 * 项目列表
 * 支持筛选：status, customer_id, supplier_id, keyword, sort (profit|sale|create), order
 */
export function getProjectList(params) {
  return request.get('/projects', { params })
}

/**
 * 利润总览（全部 + 已完成的项目汇总，用于 Dashboard）
 */
export function getProjectSummary(params) {
  return request.get('/projects/summary', { params })
}

/** 项目详情（含关联合同/收付款/库存） */
export function getProjectDetail(id) {
  return request.get(`/projects/${id}`)
}

/** 利润明细（Sankey 图数据源） */
export function getProjectProfit(id) {
  return request.get(`/projects/${id}/profit`)
}

/** 创建 */
export function createProject(data) {
  return request.post('/projects', data)
}

/** 更新（不接受聚合字段） */
export function updateProject(id, data) {
  return request.put(`/projects/${id}`, data)
}

/** 变更状态（active/completed/cancelled） */
export function changeProjectStatus(id, status) {
  return request.put(`/projects/${id}/status`, { status })
}

/** 手动刷新聚合字段（从合同/收付款/年费重算） */
export function refreshProject(id) {
  return request.post(`/projects/${id}/refresh`)
}

/** 删除（仅解除关联，不删原始单据） */
export function deleteProject(id) {
  return request.delete(`/projects/${id}`)
}
