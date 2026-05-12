/**
 * Dashboard 接口封装
 *
 * 后端前缀：/api/v1/dashboard（request.js 已配 baseURL）
 * 权限：authenticate + requireErpAccess（admin/process/agent 均可）
 */
import request from './request'

/**
 * 核心指标
 * @param {{period?: 'month'|'quarter'|'year', start?: string, end?: string}} params
 */
export function getOverview(params) {
  return request.get('/dashboard/overview', { params })
}

/** 各账户实时余额 */
export function getAccountsOverview() {
  return request.get('/dashboard/accounts')
}

/** 近 12 个月收支趋势 */
export function getTrend() {
  return request.get('/dashboard/trend')
}

/** 成本构成（按成本类别分组） */
export function getCostBreakdown(params) {
  return request.get('/dashboard/cost-breakdown', { params })
}

/** 待确认单据数 */
export function getPending() {
  return request.get('/dashboard/pending')
}

/** 应收账龄分布（5 档） */
export function getAging() {
  return request.get('/dashboard/aging')
}
