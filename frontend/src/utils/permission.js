import { useUserStore } from '@/stores/user'

/**
 * 检查当前用户是否拥有指定角色
 * @param {string|string[]} roles - 允许的角色
 * @returns {boolean}
 */
export function hasRole(roles) {
  const userStore = useUserStore()
  if (!userStore.isLoggedIn) return false
  const userRole = userStore.userInfo.role
  if (Array.isArray(roles)) {
    return roles.includes(userRole)
  }
  return userRole === roles
}

/**
 * 检查是否为管理员
 * @returns {boolean}
 */
export function isAdmin() {
  const userStore = useUserStore()
  return userStore.isAdmin
}

/**
 * 检查是否有财务权限（管理员或财务角色）
 * @returns {boolean}
 */
export function hasFinanceAccess() {
  const userStore = useUserStore()
  return userStore.isFinance
}

/**
 * 检查是否有指定操作的权限
 * @param {string} action - 操作标识
 * @returns {boolean}
 */
export function canPerform(action) {
  const userStore = useUserStore()
  const role = userStore.userInfo.role

  // 管理员拥有所有权限
  if (role === 'admin') return true

  // 权限映射表
  const permissionMap = {
    // 财务操作
    'payment:create': ['finance'],
    'payment:edit': ['finance'],
    'payment:delete': ['admin'],
    'payment:export': ['finance', 'manager'],
    // 合同操作
    'contract:create': ['finance', 'manager'],
    'contract:edit': ['finance', 'manager'],
    'contract:delete': ['admin'],
    // 发票操作
    'invoice:create': ['finance'],
    'invoice:edit': ['finance'],
    // 报销操作
    'expense:approve': ['finance', 'manager'],
    'expense:create': ['finance', 'manager', 'staff'],
    // 系统配置
    'config:edit': ['admin'],
    // 数据导入
    'import:execute': ['finance'],
    // 数据导出
    'export:execute': ['finance', 'manager']
  }

  const allowedRoles = permissionMap[action]
  if (!allowedRoles) return false
  return allowedRoles.includes(role)
}
