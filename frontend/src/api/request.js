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
    if (
      config.url?.includes('/auth/sso/initiate')
      || config.url?.includes('/auth/sso/exchange')
    ) {
      config.timeout = Math.min(Number(config.timeout) || 15000, 15000)
    }
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
      const requestUrl = response.config?.url || ''
      const pageHandlesError = [
        '/auth/features',
        '/auth/login',
        '/auth/sso/initiate',
        '/auth/sso/exchange',
        '/auth/logout'
      ].some((path) => requestUrl.includes(path))
      if (!pageHandlesError) ElMessage.error(res.message || '请求失败')

      const businessError = new Error(res.message || '请求失败')
      businessError.response = response
      return Promise.reject(businessError)
    }
    return res
  },
  (error) => {
    const { response, config } = error
    const requestUrl = config?.url || ''
    const isLogoutReq = requestUrl.includes('/auth/logout')
    const isLoginReq = requestUrl.includes('/auth/login')
    const isSsoInitiateReq = requestUrl.includes('/auth/sso/initiate')
    const isSsoExchangeReq = requestUrl.includes('/auth/sso/exchange')
    const isAuthFeaturesReq = requestUrl.includes('/auth/features')
    const isProfileReq = requestUrl.includes('/auth/profile')
    const pageHandlesError = isLogoutReq || isLoginReq || isSsoInitiateReq || isSsoExchangeReq
      || isAuthFeaturesReq || isProfileReq

    // 登录、SSO 和认证开关页面会展示可恢复的上下文信息，不再重复弹全局错误。
    if (pageHandlesError) return Promise.reject(error)

    if (response) {
      switch (response.status) {
        case 401: {
          if (!isHandling401) {
            isHandling401 = true
            const userStore = useUserStore()
            // 失效 Token 立即从内存和 localStorage 清除，不等待登出接口。
            void userStore.expireSession('session_expired')
            // 3 秒后允许再次提示
            setTimeout(() => { isHandling401 = false }, 3000)
          }
          break
        }
        case 403:
          if (!isLoginReq && !isSsoExchangeReq) {
            ElMessage.error(response.data?.message || '没有权限执行此操作')
          }
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
