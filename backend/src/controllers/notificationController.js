/**
 * ============================================================
 * 系统消息 Controller
 * ============================================================
 * 对外提供用户的消息列表 + 未读数 + 已读/删除操作。
 * 业务侧生成消息通过调用 service 的 upsert / broadcast，无接口暴露。
 * ============================================================
 */

const notificationService = require('../services/notificationService');

/** GET /api/v1/notifications */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await notificationService.getList(req.query, userId, userRole);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

/** GET /api/v1/notifications/unread-count - 未读数量（用于顶栏红点） */
async function getUnreadCount(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const count = await notificationService.getUnreadCount(userId, userRole);
    res.json({ success: true, data: { count } });
  } catch (e) { next(e); }
}

/** PUT /api/v1/notifications/:id/read */
async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await notificationService.markRead(parseInt(id, 10), userId, userRole);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

/** PUT /api/v1/notifications/read-all */
async function markAllRead(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await notificationService.markAllRead(userId, userRole);
    res.json({ success: true, message: `已标记 ${data.affected} 条为已读`, data });
  } catch (e) { next(e); }
}

/** DELETE /api/v1/notifications/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await notificationService.remove(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '消息已删除', data });
  } catch (e) { next(e); }
}

module.exports = {
  getList,
  getUnreadCount,
  markRead,
  markAllRead,
  remove
};
