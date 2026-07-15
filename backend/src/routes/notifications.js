/**
 * ============================================================
 * 系统消息路由
 * ============================================================
 * 路由前缀：/api/v1/notifications
 *
 * 中间件栈：authenticate → requirePermission → attachPermissionDataScope → validate
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
const { requirePermission } = require('../middlewares/requirePermission');
const { attachPermissionDataScope } = require('../permissions/dataScope');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const validate = require('../middlewares/validate');
const { listNotificationQuerySchema } = require('../validators/notification');

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.APP_VIEW));

// 固定路径优先
router.get('/unread-count',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  attachPermissionDataScope(PERMISSIONS.NOTIFICATION_VIEW, { ownerField: 'user_id' }),
  notificationController.getUnreadCount
);
router.put('/read-all',
  requirePermission(PERMISSIONS.NOTIFICATION_UPDATE),
  attachPermissionDataScope(PERMISSIONS.NOTIFICATION_UPDATE, { ownerField: 'user_id' }),
  notificationController.markAllRead
);

router.get('/',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  attachPermissionDataScope(PERMISSIONS.NOTIFICATION_VIEW, { ownerField: 'user_id' }),
  validate(listNotificationQuerySchema, 'query'),
  notificationController.getList
);
router.put('/:id/read',
  requirePermission(PERMISSIONS.NOTIFICATION_UPDATE),
  attachPermissionDataScope(PERMISSIONS.NOTIFICATION_UPDATE, { ownerField: 'user_id' }),
  notificationController.markRead
);
router.delete('/:id',
  requirePermission(PERMISSIONS.NOTIFICATION_DELETE),
  attachPermissionDataScope(PERMISSIONS.NOTIFICATION_DELETE, { ownerField: 'user_id' }),
  notificationController.remove
);

module.exports = router;
