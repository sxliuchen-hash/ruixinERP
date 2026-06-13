import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi, getProfile as getProfileApi, logout as logoutApi } from '@/api/auth'
import router from '@/router'

export const useUserStore = defineStore('user', () => {
  // State
  const token = ref(localStorage.getItem('erp_token') || '')
  const userInfo = ref({
    id: null,
    username: '',
    role: '',
    realName: ''
  })

  // Getters
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value.role === 'admin')
  const isFinance = computed(() => userInfo.value.role === 'process' || userInfo.value.role === 'admin')

  // Actions
  function setToken(newToken) {
    token.value = newToken
    localStorage.setItem('erp_token', newToken)
  }

  function clearAuth() {
    token.value = ''
    userInfo.value = { id: null, username: '', role: '', realName: '' }
    localStorage.removeItem('erp_token')
  }

  /**
   * 登录
   * @param {Object} credentials - { username, password }
   */
  async function login(credentials) {
    const res = await loginApi(credentials)
    setToken(res.data.token)
    userInfo.value = res.data.user
    return res.data
  }

  /**
   * 登出 - 调用后端接口并清除本地状态
   */
  async function logout() {
    try {
      await logoutApi()
    } catch {
      // 即使后端登出失败，也清除本地状态
    }
    clearAuth()
    router.push('/login')
  }

  /**
   * 获取用户信息（用于页面刷新后恢复用户状态）
   */
  async function fetchProfile() {
    try {
      const res = await getProfileApi()
      userInfo.value = res.data
      return res.data
    } catch (error) {
      clearAuth()
      throw error
    }
  }

  // 保留 getProfile 作为 fetchProfile 的别名，兼容旧代码
  const getProfile = fetchProfile

  return {
    token,
    userInfo,
    isLoggedIn,
    isAdmin,
    isFinance,
    setToken,
    login,
    logout,
    fetchProfile,
    getProfile
  }
})
