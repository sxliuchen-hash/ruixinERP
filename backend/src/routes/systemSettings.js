/**
 * 系统设置路由
 * 路由前缀：/api/v1/system-settings
 */
const express = require('express');
const router = express.Router();
const controller = require('../controllers/systemSettingController');
const { authenticate } = require('../middlewares/auth');
const { requireErpAccess, requireAdmin } = require('../middlewares/permission');

router.use(authenticate);
router.use(requireErpAccess());

// 所有人可读
router.get('/', controller.getList);
router.get('/:key', controller.getValue);

// 仅管理员可写
router.put('/:key', requireAdmin(), controller.setValue);
router.delete('/:key', requireAdmin(), controller.deleteValue);

module.exports = router;
