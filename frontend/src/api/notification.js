/**
 * 系统消息接口封装
 *
 * 后端前缀：/api/v1/notifications
 * 权限：细粒度 notification 权限；个人消息可读写，共享广播只读
 */
import request from './request'

/**
 * 消息列表
 * 支持筛选：type, level, is_read
 */
export function getNotificationList(params) {
  return request.get('/notifications', { params })
}

/** 未读数量（顶栏红点使用） */
export function getUnreadCount() {
  return request.get('/notifications/unread-count')
}

/** 标记单条已读 */
export function markNotificationRead(id) {
  return request.put(`/notifications/${id}/read`)
}

/** 全部标记已读 */
export function markAllNotificationsRead() {
  return request.put('/notifications/read-all')
}

/** 删除消息 */
export function deleteNotification(id) {
  return request.delete(`/notifications/${id}`)
}
