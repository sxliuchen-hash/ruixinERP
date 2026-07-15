import { useUserStore } from '@/stores/user'

/**
 * 检查当前用户是否具有指定 ERP 权限。
 * permissionCode 必须来自 @/constants/permissions。
 */
export function hasPermission(permissionCode) {
  return useUserStore().can(permissionCode)
}

/**
 * 兼容旧调用名称；参数现在必须是完整权限编码，而不是角色或旧 action 别名。
 */
export function canPerform(permissionCode) {
  return hasPermission(permissionCode)
}

export function permissionScope(permissionCode) {
  return useUserStore().scopeOf(permissionCode)
}
