import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  login as loginApi,
  exchangeSsoCode as exchangeSsoCodeApi,
  getProfile as getProfileApi,
  logout as logoutApi
} from '@/api/auth'
import { isKnownPermission, legacyCan, legacyScope } from '@/constants/permissions'
import router from '@/router'

const STORAGE_KEYS = Object.freeze({
  token: 'erp_token',
  permissions: 'erp_permissions',
  authSource: 'erp_auth_source',
  permissionVersion: 'erp_permission_version'
})

const VALID_PERMISSION_SCOPES = new Set(['self', 'team', 'all'])
const VALID_AUTH_SOURCES = new Set(['legacy', 'main_sso'])

function emptyUserInfo() {
  return {
    id: null,
    username: '',
    role: '',
    realName: ''
  }
}

function loadStoredPermissions() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.permissions)
    return stored ? normalizePermissions(JSON.parse(stored)) : {}
  } catch {
    localStorage.removeItem(STORAGE_KEYS.permissions)
    return {}
  }
}

function normalizePermissions(rawPermissions) {
  if (Array.isArray(rawPermissions)) {
    return Object.fromEntries(
      rawPermissions
        .filter((code) => typeof code === 'string' && isKnownPermission(code))
        .map((code) => [code, { allowed: true, scope: 'all' }])
    )
  }

  if (!rawPermissions || typeof rawPermissions !== 'object') return {}

  return Object.fromEntries(
    Object.entries(rawPermissions)
      .filter(([code]) => isKnownPermission(code))
      .map(([code, grant]) => {
      if (typeof grant === 'boolean') {
        return [code, { allowed: grant, scope: grant ? 'all' : 'none' }]
      }

      if (typeof grant === 'string') {
        const allowed = VALID_PERMISSION_SCOPES.has(grant)
        return [code, { allowed, scope: allowed ? grant : 'none' }]
      }

      const normalizedGrant = grant && typeof grant === 'object' ? grant : {}
      const requestedScope = normalizedGrant.scope
      const allowedFlag = normalizedGrant.allowed ?? normalizedGrant.granted ?? false
      const allowed = allowedFlag === true && VALID_PERMISSION_SCOPES.has(requestedScope)
      return [
        code,
        {
          ...normalizedGrant,
          allowed: allowed === true,
          scope: allowed ? requestedScope : 'none'
        }
      ]
      })
  )
}

function normalizeUserInfo(rawUser = {}) {
  return {
    ...rawUser,
    id: rawUser.id ?? rawUser.sub ?? null,
    username: rawUser.username || '',
    role: rawUser.role || '',
    realName: rawUser.realName || rawUser.real_name || ''
  }
}

export const useUserStore = defineStore('user', () => {
  // State
  const token = ref(localStorage.getItem(STORAGE_KEYS.token) || '')
  const userInfo = ref(emptyUserInfo())
  const permissions = ref(loadStoredPermissions())
  const authSource = ref(
    localStorage.getItem(STORAGE_KEYS.authSource) || ''
  )
  const permissionVersion = ref(
    localStorage.getItem(STORAGE_KEYS.permissionVersion) || ''
  )

  // Getters
  const isLoggedIn = computed(() => !!token.value)
  const hasPermissionClaims = computed(() => Object.keys(permissions.value).length > 0)

  // Actions
  function setToken(newToken) {
    token.value = newToken || ''
    if (token.value) {
      localStorage.setItem(STORAGE_KEYS.token, token.value)
    } else {
      localStorage.removeItem(STORAGE_KEYS.token)
    }
  }

  function setPermissions(newPermissions) {
    permissions.value = normalizePermissions(newPermissions)
    if (Object.keys(permissions.value).length > 0) {
      localStorage.setItem(STORAGE_KEYS.permissions, JSON.stringify(permissions.value))
    } else {
      localStorage.removeItem(STORAGE_KEYS.permissions)
    }
  }

  function setAuthMetadata(source, version) {
    authSource.value = VALID_AUTH_SOURCES.has(source) ? source : ''
    permissionVersion.value = authSource.value ? (version ?? '') : ''

    if (authSource.value) {
      localStorage.setItem(STORAGE_KEYS.authSource, authSource.value)
    } else {
      localStorage.removeItem(STORAGE_KEYS.authSource)
    }

    if (permissionVersion.value !== '') {
      localStorage.setItem(STORAGE_KEYS.permissionVersion, String(permissionVersion.value))
    } else {
      localStorage.removeItem(STORAGE_KEYS.permissionVersion)
    }
  }

  function applySession(session, fallbackAuthSource = 'legacy') {
    if (!session?.token) {
      throw new Error('登录响应缺少 ERP 访问令牌')
    }

    const rawUser = session.user || {}
    const incomingPermissions = session.permissions ?? rawUser.permissions ?? {}
    const source = session.authSource || rawUser.authSource || fallbackAuthSource
    const version = session.permissionVersion ?? rawUser.permissionVersion ?? ''

    if (!VALID_AUTH_SOURCES.has(source)) {
      throw new Error('登录响应缺少有效的认证来源')
    }

    userInfo.value = normalizeUserInfo(rawUser)
    setPermissions(incomingPermissions)
    setAuthMetadata(source, version)
    // 最后写入 Token，保证跨标签页观察到新会话时，其权限元数据已经完整落盘。
    setToken(session.token)
  }

  function can(permissionCode) {
    if (Array.isArray(permissionCode)) {
      return permissionCode.every((code) => can(code))
    }
    if (!permissionCode || typeof permissionCode !== 'string') return false
    if (!isKnownPermission(permissionCode)) return false
    if (!VALID_AUTH_SOURCES.has(authSource.value)) return false

    if (Object.prototype.hasOwnProperty.call(permissions.value, permissionCode)) {
      return permissions.value[permissionCode]?.allowed === true
    }

    // main_sso 缺失 grant 必须先明确拒绝，不能落入任何角色兼容分支。
    if (authSource.value === 'main_sso') return false
    // 只有显式 legacy 会话允许走角色兼容映射；空值和未知来源同样默认拒绝。
    if (authSource.value !== 'legacy') return false
    return legacyCan(userInfo.value.role, permissionCode)
  }

  function canAny(permissionCodes) {
    return Array.isArray(permissionCodes) && permissionCodes.some((code) => can(code))
  }

  function scopeOf(permissionCode) {
    if (!VALID_AUTH_SOURCES.has(authSource.value)) return 'none'
    if (Object.prototype.hasOwnProperty.call(permissions.value, permissionCode)) {
      const grant = permissions.value[permissionCode]
      return grant?.allowed === true && VALID_PERMISSION_SCOPES.has(grant.scope)
        ? grant.scope
        : 'none'
    }

    if (authSource.value === 'main_sso') return 'none'
    if (authSource.value !== 'legacy') return 'none'
    return legacyScope(userInfo.value.role, permissionCode)
  }

  function clearAuth() {
    token.value = ''
    userInfo.value = emptyUserInfo()
    permissions.value = {}
    authSource.value = ''
    permissionVersion.value = ''
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key))
  }

  function expireSession(reason = 'session_expired') {
    clearAuth()
    if (router.currentRoute.value.path === '/login') return Promise.resolve()
    return router.replace({ path: '/login', query: { reason } })
  }

  /**
   * 登录
   * @param {Object} credentials - { username, password }
   */
  async function login(credentials) {
    clearAuth()
    const res = await loginApi(credentials)
    applySession(res.data, 'legacy')
    return res.data
  }

  /**
   * 兑换主项目的一次性授权码并建立 ERP 会话。
   */
  async function exchangeSsoCode(code, state) {
    if (!state) throw new Error('SSO 回调缺少 state')
    clearAuth()
    const res = await exchangeSsoCodeApi(code, state)
    applySession(res.data, 'main_sso')
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
    await router.replace({ path: '/login', query: { reason: 'logged_out' } })
  }

  /**
   * 获取用户信息（用于页面刷新后恢复用户状态）
   */
  async function fetchProfile() {
    try {
      const res = await getProfileApi()
      const profile = res.data || {}
      const profileUser = profile.user || profile

      userInfo.value = normalizeUserInfo(profileUser)

      if (profile.permissions !== undefined || profileUser.permissions !== undefined) {
        setPermissions(profile.permissions ?? profileUser.permissions)
      }

      if (
        profile.authSource !== undefined ||
        profileUser.authSource !== undefined ||
        profile.permissionVersion !== undefined ||
        profileUser.permissionVersion !== undefined
      ) {
        setAuthMetadata(
          profile.authSource || profileUser.authSource || authSource.value,
          profile.permissionVersion ?? profileUser.permissionVersion ?? permissionVersion.value
        )
      }

      return res.data
    } catch (error) {
      clearAuth()
      throw error
    }
  }

  // 保留 getProfile 作为 fetchProfile 的别名，兼容旧代码
  const getProfile = fetchProfile

  // 另一标签页退出或切换账号时，本标签页不继续保留旧的内存会话。
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage || event.key !== STORAGE_KEYS.token) return
      if ((event.newValue || '') === token.value) return

      if (event.newValue) {
        window.location.reload()
      } else if (token.value) {
        void expireSession('session_expired')
      }
    })
  }

  return {
    token,
    userInfo,
    permissions,
    authSource,
    permissionVersion,
    isLoggedIn,
    hasPermissionClaims,
    setToken,
    setPermissions,
    applySession,
    can,
    canAny,
    scopeOf,
    clearAuth,
    expireSession,
    login,
    exchangeSsoCode,
    logout,
    fetchProfile,
    getProfile
  }
})
