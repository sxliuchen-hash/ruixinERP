'use strict';

const express = require('express');
const validate = require('../middlewares/validate');
const {
  requireManifestClient,
  requireProvisionClient,
  requireIdempotencyKey
} = require('../middlewares/internalServiceAuth');
const { getPermissionManifest } = require('../permissions/manifest');
const internalProvisioningController = require('../controllers/internalProvisioningController');
const { provisionEmployeeSchema } = require('../validators/internalProvisioning');

const router = express.Router();

// 主项目权限中心拉取 ERP 权限目录。该接口只返回权限定义，不返回角色授权。
router.get('/permissions/manifest', requireManifestClient, (req, res) => {
  res.json({
    success: true,
    data: getPermissionManifest()
  });
});

// 主项目账号绑定时幂等创建/同步 ERP Employee。只更新身份映射字段，
// 不覆盖工资、职级、入职日期等 ERP 人工维护数据。
router.post(
  '/provisioning/employees',
  requireProvisionClient,
  requireIdempotencyKey,
  validate(provisionEmployeeSchema),
  internalProvisioningController.provisionEmployee
);

module.exports = router;
