'use strict';

const crypto = require('crypto');
const { AppError, UnauthorizedError, ValidationError } = require('../utils/errors');

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireManifestClient(req, res, next) {
  const expectedId = process.env.ERP_MANIFEST_CLIENT_ID || '';
  const expectedSecret = process.env.ERP_MANIFEST_CLIENT_SECRET || '';

  if (!expectedId || !expectedSecret) {
    return next(new AppError(
      '权限目录内部接口服务凭证未配置',
      503,
      'MANIFEST_API_CONFIGURATION_ERROR'
    ));
  }

  const clientIdHeader = (process.env.ERP_MANIFEST_CLIENT_ID_HEADER || 'X-ERP-Manifest-Client-Id').toLowerCase();
  const clientSecretHeader = (process.env.ERP_MANIFEST_CLIENT_SECRET_HEADER || 'X-ERP-Manifest-Client-Secret').toLowerCase();
  const actualId = req.headers[clientIdHeader];
  const actualSecret = req.headers[clientSecretHeader];

  if (!safeEqual(actualId, expectedId) || !safeEqual(actualSecret, expectedSecret)) {
    return next(new UnauthorizedError('内部服务凭证无效'));
  }

  next();
}

function requireProvisionClient(req, res, next) {
  const expectedId = process.env.ERP_PROVISION_CLIENT_ID || '';
  const expectedSecret = process.env.ERP_PROVISION_CLIENT_SECRET || '';

  if (!expectedId || !expectedSecret) {
    return next(new AppError(
      'Employee 建档内部接口服务凭证未配置',
      503,
      'PROVISION_API_CONFIGURATION_ERROR'
    ));
  }

  const clientIdHeader = (
    process.env.ERP_PROVISION_CLIENT_ID_HEADER || 'X-Main-Provision-Client-Id'
  ).toLowerCase();
  const clientSecretHeader = (
    process.env.ERP_PROVISION_CLIENT_SECRET_HEADER || 'X-Main-Provision-Client-Secret'
  ).toLowerCase();
  const actualId = req.headers[clientIdHeader];
  const actualSecret = req.headers[clientSecretHeader];

  if (!safeEqual(actualId, expectedId) || !safeEqual(actualSecret, expectedSecret)) {
    return next(new UnauthorizedError('内部服务凭证无效'));
  }

  next();
}

function requireIdempotencyKey(req, res, next) {
  const key = req.get
    ? req.get('Idempotency-Key')
    : req.headers?.['idempotency-key'];
  if (typeof key !== 'string' || key.trim().length < 8 || key.trim().length > 200) {
    return next(new ValidationError('Idempotency-Key 必须为 8～200 位字符串'));
  }
  req.idempotencyKey = key.trim();
  next();
}

module.exports = {
  safeEqual,
  requireManifestClient,
  requireProvisionClient,
  requireIdempotencyKey
};
