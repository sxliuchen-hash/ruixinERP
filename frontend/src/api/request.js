import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
let isHandling401 = false // 防止 401 重复处理导致刷屏

request.interceptors.response.use(
  (response) => {
    const res = response.data
    // 如果后端返回的不是成功状态
    if (res.code && res.code !== 200 && res.code !== 0) {
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    return res
  },
  (error) => {
    const { response, config } = error
    if (response) {
      switch (response.status) {
        case 401: {
          // 登出接口本身的 401 直接忽略，避免循环
          const isLogoutReq = config && config.url && config.url.includes('/auth/logout')
          if (!isLogoutReq && !isHandling401) {
            isHandling401 = true
            ElMessage.error('登录已过期，请重新登录')
            const userStore = useUserStore()
            userStore.logout()
            // 3 秒后允许再次提示
            setTimeout(() => { isHandling401 = false }, 3000)
          }
          break
        }
        case 403:
          ElMessage.error('没有权限执行此操作')
          break
        case 404:
          ElMessage.error('请求的资源不存在')
          break
        case 500:
          ElMessage.error('服务器内部错误')
          break
        default:
          ElMessage.error(response.data?.message || `请求失败 (${response.status})`)
      }
    } else {
      ElMessage.error('网络连接失败，请检查网络')
    }
    return Promise.reject(error)
  }
)

export default request
