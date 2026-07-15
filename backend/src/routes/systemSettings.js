/**
 * 系统设置路由
 * 路由前缀：/api/v1/system-settings
 */
const express = require('express');
const router = express.Router();
const controller = require('../controllers/systemSettingController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { requireFreshPermissionVersion } = require('../middlewares/permissionVersion');
const { PERMISSIONS } = require('../permissions/permissionCodes');

router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.SYSTEM_VIEW), controller.getList);
router.get('/:key', requirePermission(PERMISSIONS.SYSTEM_VIEW), controller.getValue);

router.put('/:key', requirePermission(PERMISSIONS.SYSTEM_UPDATE), requireFreshPermissionVersion(), controller.setValue);
router.delete('/:key', requirePermission(PERMISSIONS.SYSTEM_DELETE), requireFreshPermissionVersion(), controller.deleteValue);

module.exports = router;
