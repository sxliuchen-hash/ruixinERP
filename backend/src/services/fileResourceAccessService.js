'use strict';

const Contract = require('../models/Contract');
const { buildDataScopeFilter } = require('../permissions/dataScope');
const { getPermissionGrant } = require('../permissions/permissionGrant');
const { PERMISSIONS } = require('../permissions/permissionCodes');
const mainUserScopeService = require('./mainUserScopeService');
const { ForbiddenError, ValidationError } = require('../utils/errors');

const SUPPORTED_FILE_PREFIXES = Object.freeze([
  'erp-files/',
  'erp/contracts/',
  'uploads/'
]);

function normalizeFileKey(key) {
  return String(key || '').replace(/^\/+/, '');
}

function isAllowedFileKey(key) {
  const normalizedKey = normalizeFileKey(key);
  return SUPPORTED_FILE_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix));
}

function extractFileKey(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  let candidate = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      candidate = new URL(raw).pathname;
    }
  } catch (_error) {
    return '';
  }

  try {
    candidate = decodeURIComponent(candidate);
  } catch (_error) {
    // 非法转义按原始路径继续处理，最终仍需经过前缀白名单。
  }

  const normalizedKey = normalizeFileKey(candidate);
  return isAllowedFileKey(normalizedKey) ? normalizedKey : '';
}

function collectContractAttachmentKeys(attachmentUrl) {
  if (!attachmentUrl) return [];

  let entries;
  try {
    const parsed = JSON.parse(attachmentUrl);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    entries = [attachmentUrl];
  }

  return [...new Set(entries
    .map((entry) => {
      if (typeof entry === 'string') return extractFileKey(entry);
      if (!entry || typeof entry !== 'object') return '';
      return extractFileKey(entry.key || entry.url);
    })
    .filter(Boolean))];
}

async function assertContractFileAccess({ user, resourceId, key }) {
  const contractId = Number(resourceId);
  const normalizedKey = extractFileKey(key);
  if (!Number.isInteger(contractId) || contractId <= 0 || !normalizedKey) {
    throw new ValidationError('文件资源参数无效');
  }

  const dataFilter = await buildDataScopeFilter({
    user,
    permissionCode: PERMISSIONS.CONTRACT_VIEW,
    ownerField: 'owner_id',
    resolveTeamUserIds: (userId) => mainUserScopeService.getTeamUserIds(userId)
  });
  const contract = await Contract.findOne({
    where: { id: contractId, ...dataFilter },
    attributes: ['id', 'attachment_url']
  });

  if (!contract) {
    throw new ForbiddenError('无权访问该合同附件');
  }

  const attachmentKeys = collectContractAttachmentKeys(contract.attachment_url);
  if (!attachmentKeys.includes(normalizedKey)) {
    throw new ForbiddenError('文件不属于当前合同');
  }

  const grant = getPermissionGrant(user, PERMISSIONS.CONTRACT_VIEW);
  return {
    key: normalizedKey,
    resourceType: 'contract',
    resourceId: contractId,
    permissionCode: PERMISSIONS.CONTRACT_VIEW,
    permissionScope: grant.scope
  };
}

async function assertFileResourceAccess({ user, resourceType, resourceId, key }) {
  if (!user?.id) throw new ForbiddenError('缺少文件访问用户');

  if (String(resourceType || '').trim().toLowerCase() === 'contract') {
    return assertContractFileAccess({ user, resourceId, key });
  }

  throw new ValidationError('不支持的文件资源类型');
}

module.exports = {
  SUPPORTED_FILE_PREFIXES,
  normalizeFileKey,
  isAllowedFileKey,
  extractFileKey,
  collectContractAttachmentKeys,
  assertFileResourceAccess
};
