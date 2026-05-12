/**
 * 历史数据导入接口封装
 *
 * 支持的导入类型：contracts / payments / inventory / costs
 */
import request from './request'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'

/**
 * 下载导入模板（触发浏览器下载）
 * @param {string} type 导入类型
 */
export async function downloadTemplate(type) {
  const userStore = useUserStore()
  const url = new URL(`/api/v1/import/template/${type}`, window.location.origin)

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: userStore.token ? `Bearer ${userStore.token}` : ''
      }
    })

    if (!res.ok) {
      let msg = `下载失败（HTTP ${res.status}）`
      try {
        const errData = await res.json()
        msg = errData.message || msg
      } catch (_) { /* 非 JSON */ }
      ElMessage.error(msg)
      throw new Error(msg)
    }

    // 解析文件名
    const disposition = res.headers.get('Content-Disposition')
    let filename = `导入模板_${type}.xlsx`
    if (disposition) {
      const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
      if (starMatch) {
        try { filename = decodeURIComponent(starMatch[1]) } catch (_) { /* fallback */ }
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
    if (!error.message.startsWith('下载失败')) {
      ElMessage.error('模板下载失败：' + error.message)
    }
    throw error
  }
}

/**
 * 上传 Excel 预览校验
 * @param {string} type 导入类型
 * @param {File} file Excel 文件
 * @returns {Promise<Object>} { total, validCount, errorCount, valid, errors }
 */
export function validateImportFile(type, file) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post(`/import/validate/${type}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/**
 * 确认导入（事务批量写入）
 * @param {string} type 导入类型
 * @param {Array} validRows validate 接口返回的 valid 数组
 * @returns {Promise<Object>} { imported, skipped, details }
 */
export function executeImport(type, validRows) {
  return request.post(`/import/execute/${type}`, { validRows })
}
