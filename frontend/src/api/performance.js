/**
 * 业绩统计接口
 */
import request from './request'

/** 业绩概览（统计卡片） */
export function getPerformanceOverview(params) {
  return request.get('/performance/overview', { params })
}

/** 月度排名 */
export function getPerformanceRanking(params) {
  return request.get('/performance/ranking', { params })
}

/** 业绩趋势 */
export function getPerformanceTrend(params) {
  return request.get('/performance/trend', { params })
}

/** 季度汇总 */
export function getQuarterlySummary(params) {
  return request.get('/performance/quarterly', { params })
}

/** 提成试算 */
export function calculateCommission(params) {
  return request.get('/performance/commission', { params })
}

/** 采购提成月度报表（按采购人员） */
export function getPurchaseCommission(params) {
  return request.get('/performance/purchase-commission', { params })
}
