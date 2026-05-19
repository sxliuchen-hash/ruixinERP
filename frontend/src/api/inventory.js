/**
 * 专利库存管理接口封装
 *
 * 后端前缀：/api/v1/inventory
 * 权限：authenticate + requireErpAccess + attachDataFilter
 *       （agent 仅能看/改自己 created_by 的记录）
 */
import request from './request'

// ============ 库存主资源 ============

/**
 * 库存列表
 * 支持筛选：status, tech_field, supplier_id, project_id,
 *           min_age, max_age, sort (age|profit|price|deadline), order,
 *           keyword（专利号/名称/备注）
 */
export function getInventoryList(params) {
  return request.get('/inventory', { params })
}

/** 详情（含 annualFees + priceHistory） */
export function getInventoryDetail(id) {
  return request.get(`/inventory/${id}`)
}

/** 入库 */
export function createInventory(data) {
  return request.post('/inventory', data)
}

/** 编辑（不接受 current_price / total_maintain_cost） */
export function updateInventory(id, data) {
  return request.put(`/inventory/${id}`, data)
}

/** 删除（级联删除年费和调价历史） */
export function deleteInventory(id) {
  return request.delete(`/inventory/${id}`)
}

/**
 * 批量删除（仅管理员）
 * @param {number[]} ids - 要删除的库存 ID 数组
 */
export function batchDeleteInventory(ids) {
  return request.post('/inventory/batch-delete', { ids })
}

/**
 * 变更状态（in_stock / sold / abandoned / transferring）
 * @param {number} id
 * @param {{status, stock_out_date?}} data
 */
export function changeInventoryStatus(id, data) {
  return request.put(`/inventory/${id}/status`, data)
}

// ============ 调价 ============

/**
 * 单个调价
 * @param {number} id
 * @param {{new_price, change_date?, reason?}} data
 */
export function changeInventoryPrice(id, data) {
  return request.put(`/inventory/${id}/price`, data)
}

/**
 * 批量调价
 * @param {Object} data
 * @param {'fixed'|'percent'} data.mode
 * @param {number} [data.new_price]  mode=fixed 必填
 * @param {number} [data.percent]    mode=percent 必填（如 10 表 +10%）
 * @param {number[]} [data.ids]
 * @param {string} [data.tech_field]
 * @param {string} [data.status]
 * @param {string} [data.reason]
 * @param {string} [data.change_date]
 */
export function batchChangePrice(data) {
  return request.put('/inventory/batch-price', data)
}

// ============ 年费子资源 ============

/**
 * 添加年费记录
 * @param {number} id 库存 ID
 * @param {{fee_type?, amount, fee_date, deadline_date?, payment_id?, remark?}} data
 */
export function addAnnualFee(id, data) {
  return request.post(`/inventory/${id}/fees`, data)
}

/** 删除年费记录 */
export function deleteAnnualFee(id, feeId) {
  return request.delete(`/inventory/${id}/fees/${feeId}`)
}

// ============ IP 系统数据同步 ============

/**
 * 从 IP 系统同步专利信息（名称/类型/截止日）到本地库存
 * @param {number} id 库存 ID
 */
export function syncFromIpSystem(id) {
  return request.post(`/inventory/${id}/sync-from-ip`)
}

// ============ 异常告警 ============

/**
 * 异常告警列表
 * @param {Object} params { page, pageSize, severity, anomaly_type, is_resolved, patent_no }
 */
export function getAnomalies(params) {
  return request.get('/inventory/anomalies', { params })
}

/** 异常告警统计 */
export function getAnomalyOverview() {
  return request.get('/inventory/anomalies/overview')
}

/**
 * 标记告警为已处理
 * @param {number} id 告警 ID
 * @param {string} note 处理备注
 */
export function resolveAnomaly(id, note) {
  return request.put(`/inventory/anomalies/${id}/resolve`, { note })
}

/** 手动触发批量扫描（仅管理员） */
export function triggerAnomalyScan() {
  return request.post('/inventory/anomalies/scan')
}

/** 获取扫描进度 */
export function getScanProgress() {
  return request.get('/inventory/anomalies/scan-progress')
}

/** 停止扫描 */
export function stopAnomalyScan() {
  return request.post('/inventory/anomalies/scan-stop')
}

// ============ 聚合接口 ============

/** 库存总览统计 */
export function getInventoryOverview() {
  return request.get('/inventory/overview')
}

/**
 * 即将到期列表
 * @param {{days?: number}} params 默认 60 天
 */
export function getExpiringInventory(params) {
  return request.get('/inventory/expiring', { params })
}

// ============ 批量入库 ============

/** 下载批量入库模板 */
export function downloadBatchImportTemplate() {
  return request.get('/inventory/batch-import/template', {
    responseType: 'blob'
  })
}

/**
 * 上传 Excel 预览校验
 * @param {File} file - Excel 文件
 */
export function validateBatchImport(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/inventory/batch-import/validate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/**
 * 确认批量入库
 * @param {Array} validRows - 校验通过的行数据
 */
export function executeBatchImport(validRows) {
  return request.post('/inventory/batch-import/execute', { validRows })
}
