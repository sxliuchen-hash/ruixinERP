/**
 * 报销管理接口封装
 *
 * 后端前缀：/api/v1/expenses
 * 权限：authenticate + requireErpAccess + attachDataFilter
 *       （agent 仅能看/改自己 created_by 的记录）
 */
import request from './request'

/**
 * 报销列表（分页 + 多维筛选）
 * 支持筛选：user_id, cost_category_id, account_id, confirm_status,
 *           start_date, end_date, keyword
 */
export function getExpenseList(params) {
  return request.get('/expenses', { params })
}

/** 详情 */
export function getExpenseDetail(id) {
  return request.get(`/expenses/${id}`)
}

/** 创建 */
export function createExpense(data) {
  return request.post('/expenses', data)
}

/** 更新 */
export function updateExpense(id, data) {
  return request.put(`/expenses/${id}`, data)
}

/** 删除 */
export function deleteExpense(id) {
  return request.delete(`/expenses/${id}`)
}

/** 确认（pending → confirmed） */
export function confirmExpense(id) {
  return request.put(`/expenses/${id}/confirm`)
}

/**
 * 按类别汇总（仅统计 confirmed）
 * @param {{start_date?: string, end_date?: string}} params
 */
export function getExpenseCategorySummary(params) {
  return request.get('/expenses/summary/category', { params })
}

/**
 * 按报销人汇总
 */
export function getExpenseUserSummary(params) {
  return request.get('/expenses/summary/user', { params })
}

/**
 * 按月度汇总（近 N 个月）
 * @param {{months?: number}} params 默认 12 个月
 */
export function getExpenseMonthlySummary(params) {
  return request.get('/expenses/summary/monthly', { params })
}
