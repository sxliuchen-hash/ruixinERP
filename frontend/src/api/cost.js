/**
 * 成本管理接口封装
 *
 * 后端前缀：/api/v1/costs
 * 权限：按 erp.cost.view 及具体操作权限编码校验。
 *       成本数据只支持 all scope；类别 CRUD 按 erp.cost.create/update/delete 控制。
 */
import request from './request'

// ============ 成本类别 ============

/** 类别列表（平铺） */
export function getCostCategoryList(params) {
  return request.get('/costs/categories', { params })
}

/** 类别树（两级，仅启用的类别） */
export function getCostCategoryTree() {
  return request.get('/costs/categories/tree')
}

/** 创建类别（erp.cost.create） */
export function createCostCategory(data) {
  return request.post('/costs/categories', data)
}

/** 更新类别（erp.cost.update） */
export function updateCostCategory(id, data) {
  return request.put(`/costs/categories/${id}`, data)
}

/** 删除类别（erp.cost.delete，有引用则拒绝） */
export function deleteCostCategory(id) {
  return request.delete(`/costs/categories/${id}`)
}

// ============ 成本记录 ============

/**
 * 成本记录列表
 * 支持筛选：category_id, type, cost_month, user_id, is_recurring,
 *           start_month, end_month, keyword
 */
export function getCostRecordList(params) {
  return request.get('/costs/records', { params })
}

/** 创建记录 */
export function createCostRecord(data) {
  return request.post('/costs/records', data)
}

/** 更新记录 */
export function updateCostRecord(id, data) {
  return request.put(`/costs/records/${id}`, data)
}

/** 删除记录 */
export function deleteCostRecord(id) {
  return request.delete(`/costs/records/${id}`)
}

// ============ 汇总分析 ============

/** 月度汇总（近 N 月，含按大类分解） */
export function getCostMonthlySummary(params) {
  return request.get('/costs/summary/monthly', { params })
}

/** 按大类汇总（Dashboard 饼图） */
export function getCostTypeBreakdown(params) {
  return request.get('/costs/summary/type', { params })
}

/** 按二级类别汇总 */
export function getCostCategoryBreakdown(params) {
  return request.get('/costs/summary/category', { params })
}

/** 同比环比 */
export function getCostYoyMom(params) {
  return request.get('/costs/summary/yoy-mom', { params })
}

/** 固定月费自动生成（erp.cost.generate 手动触发） */
export function generateRecurringCosts(data) {
  return request.post('/costs/recurring/generate', data)
}
