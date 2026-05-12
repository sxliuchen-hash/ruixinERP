/**
 * 数据导出接口封装
 *
 * 用原生 fetch 直接处理二进制下载，绕过 axios 响应拦截器。
 * 自动从 Content-Disposition 头提取文件名并触发浏览器下载。
 */
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'

/**
 * 下载 Excel 文件
 *
 * @param {string} path 导出路径（相对 /api/v1，例如 '/export/payments'）
 * @param {Object} [params] URL 查询参数
 * @returns {Promise<void>}
 */
export async function downloadExcel(path, params) {
  const userStore = useUserStore()

  // 拼 URL
  const url = new URL(`/api/v1${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, v)
      }
    })
  }

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: userStore.token ? `Bearer ${userStore.token}` : ''
      }
    })

    if (!res.ok) {
      // 尝试读取 JSON 错误消息
      let msg = `导出失败（HTTP ${res.status}）`
      try {
        const errData = await res.json()
        msg = errData.message || msg
      } catch (_) { /* 非 JSON 响应 */ }

      if (res.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        userStore.logout()
      } else {
        ElMessage.error(msg)
      }
      throw new Error(msg)
    }

    // 解析 Content-Disposition 提取 filename
    const filename = parseFilename(res.headers.get('Content-Disposition')) || '导出.xlsx'
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
    if (error.message && !error.message.startsWith('导出失败')) {
      ElMessage.error('导出失败：' + error.message)
    }
    throw error
  }
}

/**
 * 从 Content-Disposition 头解析文件名
 * 兼容两种形式：filename="xxx.xlsx" 和 filename*=UTF-8''xxx.xlsx
 */
function parseFilename(header) {
  if (!header) return null
  // 优先 filename*=UTF-8''xxx
  const starMatch = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1])
    } catch (e) {
      return starMatch[1]
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i)
  if (plainMatch) return plainMatch[1]
  return null
}
