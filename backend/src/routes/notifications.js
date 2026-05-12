/**
 * ============================================================
 * 系统消息路由
 * ============================================================
 * 路由前缀：/api/v1/notifications
 *
 * 中间件栈：authenticate → requireErpAccess → validate
 * 不接 operationLog（消息是系统自动产生，用户操作仅为"已读/删除"，不重要）
 *
 * 资源树：
 *   GET    /                      当前用户消息列表
 *   GET    /unread-count          未读数量（顶栏红点）
 *   PUT    /read-all              全部标记已读
 *   PUT    /:id/read              标记单条已读
 *   DELETE /:id                   删除消息
 * ============================================================
 */
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess } = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { listNotificationQuerySchema } = require('../validators/notification');

router.use(authenticate);
router.use(requireErpAccess());

// 固定路径优先
router.get('/unread-count', notificationController.getUnreadCount);
router.put('/read-all', notificationController.markAllRead);

router.get('/',
  validate(listNotificationQuerySchema, 'query'),
  notificationController.getList
);
router.put('/:id/read', notificationController.markRead);
router.delete('/:id', notificationController.remove);

module.exports = router;
