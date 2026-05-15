/**
 * 专利年费查询接口封装（代理 IP 系统）
 *
 * 后端前缀：/api/v1/patent-fee
 * 权限：authenticate + requireErpAccess
 */
import request from './request'

/**
 * 获取单个专利的完整年费详情
 * 包含：应缴年费、已缴年费、发文、质押、许可、变更
 * @param {string} patentNo - 专利号
 */
export function getPatentFeeDetail(patentNo) {
  return request.get(`/patent-fee/detail/${encodeURIComponent(patentNo)}`)
}

/**
 * 获取专利基本信息（发明人/代理/IPC/授权等）
 * @param {string} patentNo - 专利号
 */
export function getPatentInfo(patentNo) {
  return request.get(`/patent-fee/info/${encodeURIComponent(patentNo)}`)
}

/**
 * 年费列表（分页、筛选）
 * @param {Object} params
 * @param {number} [params.page] - 页码
 * @param {number} [params.pageSize] - 每页条数
 * @param {string} [params.keyword] - 搜索关键词
 * @param {string} [params.feeStatus] - 年费状态
 * @param {string} [params.urgencyLevel] - 紧急度
 * @param {string} [params.sortField] - 排序字段
 * @param {string} [params.sortOrder] - 排序方向
 */
export function getPatentFeeList(params) {
  return request.get('/patent-fee/list', { params })
}

/**
 * 年费统计面板
 * @returns {{ urgent, warning, overdue, normal, terminated, total }}
 */
export function getPatentFeeDashboard() {
  return request.get('/patent-fee/dashboard')
}
