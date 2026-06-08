/**
 * 业绩上传接口封装
 */
import request from './request'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'

/**
 * 下载业绩统计表模板（触发浏览器下载）
 */
export async function downloadPerformanceTemplate() {
  const userStore = useUserStore()
  const url = new URL('/api/v1/performance-import/template', window.location.origin)
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: userStore.token ? `Bearer ${userStore.token}` : '' }
    })
    if (!res.ok) {
      let msg = `下载失败（HTTP ${res.status}）`
      try { const e = await res.json(); msg = e.message || msg } catch (_) { /* noop */ }
      ElMessage.error(msg)
      throw new Error(msg)
    }
    const disposition = res.headers.get('Content-Disposition')
    let filename = '业绩统计表模板.xlsx'
    if (disposition) {
      const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
      if (starMatch) {
        try { filename = decodeURIComponent(starMatch[1]) } catch (_) { /* noop */ }
      } else {
        const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
        if (plainMatch) filename = plainMatch[1]
      }
    }
    const blob = await res.blob()
    const link = document.createElement('a')
    link.href = window.URL.createObjectURL(blob)
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => window.URL.revokeObjectURL(link.href), 1000)
    ElMessage.success(`已下载：${filename}`)
  } catch (error) {
    if (!String(error.message).startsWith('下载失败')) {
      ElMessage.error('模板下载失败：' + error.message)
    }
    throw error
  }
}

/**
 * 上传业绩表预览校验
 * @param {File} file
 * @param {number} year 回退归属年
 * @param {number} month 回退归属月
 */
export function validatePerformanceFile(file, year, month) {
  const formData = new FormData()
  formData.append('file', file)
  if (year) formData.append('year', year)
  if (month) formData.append('month', month)
  return request.post('/performance-import/validate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/**
 * 确认入库
 * @param {Object} data { year, month, file_name, records }
 */
export function confirmPerformanceImport(data) {
  return request.post('/performance-import/confirm', data)
}

/** 批次列表 */
export function getPerformanceBatches(params) {
  return request.get('/performance-import/batches', { params })
}

/** 批次明细 */
export function getPerformanceBatchRecords(id) {
  return request.get(`/performance-import/batches/${id}`)
}

/** 删除批次 */
export function deletePerformanceBatch(id) {
  return request.delete(`/performance-import/batches/${id}`)
}
