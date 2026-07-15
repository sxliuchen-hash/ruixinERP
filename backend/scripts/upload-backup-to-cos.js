'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RECEIPT_SCHEMA_VERSION = 1;
const DUMP_PROFILE_VERSION = 'erp-db-full-v1';

function createBackupId(randomUUID = crypto.randomUUID) {
  const uuid = randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(uuid)) {
    throw new BackupCosError(
      'COS_BACKUP_RANDOM_ID_INVALID',
      '无法生成安全的随机 backupId',
      EXIT_CODES.UNEXPECTED
    );
  }
  return `erp-${uuid.toLowerCase()}`;
}

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  UPLOAD: 3,
  VERIFY: 4
});

class BackupCosError extends Error {
  constructor(code, message, exitCode, cause) {
    super(message);
    this.name = 'BackupCosError';
    this.code = code;
    this.exitCode = exitCode;
    this.isOperational = true;
    if (cause) this.cause = cause;
  }
}

function required(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value || /^<.*>$/.test(value) || /^your[_-]/i.test(value)) {
    throw new BackupCosError(
      'COS_BACKUP_CONFIG_MISSING',
      `缺少 ${name}`,
      EXIT_CODES.CONFIG
    );
  }
  return value;
}

function loadConfig(env = process.env, fileSystem = fs, platform = process.platform) {
  const sizeValue = required(env, 'BACKUP_SIZE');
  const config = {
    secretId: required(env, 'COS_BACKUP_SECRET_ID'),
    secretKey: required(env, 'COS_BACKUP_SECRET_KEY'),
    bucket: required(env, 'COS_BACKUP_BUCKET'),
    region: required(env, 'COS_BACKUP_REGION'),
    filePath: path.resolve(required(env, 'BACKUP_FILE')),
    objectKey: required(env, 'BACKUP_OBJECT_KEY'),
    sha256: required(env, 'BACKUP_SHA256').toLowerCase(),
    size: Number(sizeValue),
    backupDir: path.resolve(required(env, 'BACKUP_DIR')),
    receiptPath: path.resolve(required(env, 'BACKUP_RECEIPT_PATH')),
    backupId: createBackupId(),
    createdAt: required(env, 'BACKUP_CREATED_AT'),
    databaseName: required(env, 'BACKUP_DATABASE_NAME'),
    sourceServerUuid: required(env, 'BACKUP_SOURCE_SERVER_UUID'),
    dumpProfileVersion: required(env, 'BACKUP_DUMP_PROFILE_VERSION')
  };

  if (!/^erp-backups\/db\/erp_db_\d{8}_\d{6}\.sql\.gz$/.test(config.objectKey)) {
    throw new BackupCosError(
      'COS_BACKUP_OBJECT_KEY_INVALID',
      'BACKUP_OBJECT_KEY 不符合固定备份对象命名规则',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[a-f0-9]{64}$/.test(config.sha256)) {
    throw new BackupCosError(
      'COS_BACKUP_SHA256_INVALID',
      'BACKUP_SHA256 必须是 64 位十六进制摘要',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[1-9]\d*$/.test(sizeValue) || !Number.isSafeInteger(config.size)) {
    throw new BackupCosError(
      'COS_BACKUP_SIZE_INVALID',
      'BACKUP_SIZE 必须是正整数',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/i.test(config.bucket)) {
    throw new BackupCosError(
      'COS_BACKUP_BUCKET_INVALID',
      'COS_BACKUP_BUCKET 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[a-z0-9-]+$/i.test(config.region)) {
    throw new BackupCosError(
      'COS_BACKUP_REGION_INVALID',
      'COS_BACKUP_REGION 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(config.createdAt) ||
      Number.isNaN(Date.parse(config.createdAt))) {
    throw new BackupCosError(
      'COS_BACKUP_CREATED_AT_INVALID',
      'BACKUP_CREATED_AT 必须是 UTC ISO 时间',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[A-Za-z0-9_]{1,64}$/.test(config.databaseName)) {
    throw new BackupCosError(
      'COS_BACKUP_DATABASE_NAME_INVALID',
      'BACKUP_DATABASE_NAME 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(config.sourceServerUuid)) {
    throw new BackupCosError(
      'COS_BACKUP_SOURCE_UUID_INVALID',
      'BACKUP_SOURCE_SERVER_UUID 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  if (config.dumpProfileVersion !== DUMP_PROFILE_VERSION) {
    throw new BackupCosError(
      'COS_BACKUP_DUMP_PROFILE_INVALID',
      'BACKUP_DUMP_PROFILE_VERSION 不受支持',
      EXIT_CODES.CONFIG
    );
  }
  const businessBucket = typeof env.COS_BUCKET === 'string' ? env.COS_BUCKET.trim() : '';
  if (businessBucket && businessBucket.toLowerCase() === config.bucket.toLowerCase()) {
    throw new BackupCosError(
      'COS_BACKUP_BUCKET_REUSED',
      'COS_BACKUP_BUCKET 不得复用业务 COS_BUCKET',
      EXIT_CODES.CONFIG
    );
  }

  let stats;
  let backupDirStats;
  let artifactLstat;
  try {
    backupDirStats = fileSystem.lstatSync(config.backupDir);
    if (!backupDirStats.isDirectory() || backupDirStats.isSymbolicLink()) {
      throw new Error('backup dir is not a regular directory');
    }
    artifactLstat = fileSystem.lstatSync(config.filePath);
    if (!artifactLstat.isFile() || artifactLstat.isSymbolicLink()) {
      throw new Error('backup artifact is not a regular file');
    }
    stats = fileSystem.statSync(config.filePath);
  } catch (error) {
    throw new BackupCosError(
      'COS_BACKUP_FILE_UNAVAILABLE',
      'BACKUP_FILE 不存在或不可读',
      EXIT_CODES.CONFIG,
      error
    );
  }
  if (platform !== 'win32' && (backupDirStats.mode & 0o077) !== 0) {
    throw new BackupCosError(
      'COS_BACKUP_DIR_MODE_INVALID',
      'BACKUP_DIR 禁止组或其他用户访问',
      EXIT_CODES.CONFIG
    );
  }
  if (platform !== 'win32' && (artifactLstat.mode & 0o777) !== 0o600) {
    throw new BackupCosError(
      'COS_BACKUP_FILE_MODE_INVALID',
      'BACKUP_FILE 权限必须严格为 0600',
      EXIT_CODES.CONFIG
    );
  }
  if (!stats.isFile() || stats.size !== config.size) {
    throw new BackupCosError(
      'COS_BACKUP_LOCAL_SIZE_MISMATCH',
      'BACKUP_FILE 本地大小与 BACKUP_SIZE 不一致',
      EXIT_CODES.CONFIG
    );
  }
  const relativeArtifact = path.relative(config.backupDir, config.filePath);
  const expectedReceipt = `${config.filePath}.receipt.json`;
  if (
    relativeArtifact.startsWith('..') ||
    path.isAbsolute(relativeArtifact) ||
    path.dirname(relativeArtifact) !== '.' ||
    config.receiptPath !== expectedReceipt
  ) {
    throw new BackupCosError(
      'COS_BACKUP_RECEIPT_SCOPE_INVALID',
      'receipt 和备份工件必须位于 BACKUP_DIR 直属范围内',
      EXIT_CODES.CONFIG
    );
  }
  try {
    const receiptStats = fileSystem.lstatSync(config.receiptPath);
    if (receiptStats.isSymbolicLink()) {
      throw new BackupCosError(
        'COS_BACKUP_RECEIPT_SYMLINK_FORBIDDEN',
        'BACKUP_RECEIPT_PATH 不得是符号链接',
        EXIT_CODES.CONFIG
      );
    }
    throw new BackupCosError(
      'COS_BACKUP_RECEIPT_ALREADY_EXISTS',
      'BACKUP_RECEIPT_PATH 已存在',
      EXIT_CODES.CONFIG
    );
  } catch (error) {
    if (error instanceof BackupCosError) throw error;
    if (error?.code !== 'ENOENT') {
      throw new BackupCosError(
        'COS_BACKUP_RECEIPT_UNAVAILABLE',
        '无法安全检查 BACKUP_RECEIPT_PATH',
        EXIT_CODES.CONFIG,
        error
      );
    }
  }
  return config;
}

function createClient(config, COSClass) {
  const COS = COSClass || require('cos-nodejs-sdk-v5');
  return new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
}

function invoke(client, method, params) {
  return new Promise((resolve, reject) => {
    try {
      client[method](params, (error, data) => {
        if (error) reject(error);
        else resolve(data || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeHeaders(data) {
  return Object.fromEntries(
    Object.entries(data?.headers || {}).map(
      ([name, value]) => [name.toLowerCase(), String(value)]
    )
  );
}

async function uploadAndVerify({ config, client, fileSystem = fs }) {
  const params = {
    Bucket: config.bucket,
    Region: config.region,
    Key: config.objectKey
  };
  try {
    await invoke(client, 'putObject', {
      ...params,
      Body: fileSystem.createReadStream(config.filePath),
      ContentLength: config.size,
      ContentType: 'application/gzip',
      Headers: { 'x-cos-meta-sha256': config.sha256 }
    });
  } catch (error) {
    throw new BackupCosError(
      'COS_BACKUP_UPLOAD_FAILED',
      'COS 备份对象上传失败',
      EXIT_CODES.UPLOAD,
      error
    );
  }

  let head;
  try {
    head = await invoke(client, 'headObject', params);
  } catch (error) {
    throw new BackupCosError(
      'COS_BACKUP_HEAD_FAILED',
      'COS 备份对象 HEAD 失败',
      EXIT_CODES.VERIFY,
      error
    );
  }
  const headers = normalizeHeaders(head);
  if (Number(headers['content-length']) !== config.size) {
    throw new BackupCosError(
      'COS_BACKUP_HEAD_SIZE_MISMATCH',
      'COS 对象长度与本地备份不一致',
      EXIT_CODES.VERIFY
    );
  }
  if (headers['x-cos-meta-sha256'] !== config.sha256) {
    throw new BackupCosError(
      'COS_BACKUP_HEAD_SHA256_MISMATCH',
      'COS 对象 SHA256 元数据与本地备份不一致',
      EXIT_CODES.VERIFY
    );
  }
  return {
    ok: true,
    key: config.objectKey,
    size: config.size,
    sha256: config.sha256,
    headMetadata: {
      contentLength: headers['content-length'],
      sha256: headers['x-cos-meta-sha256'],
      contentType: headers['content-type'] || 'application/gzip'
    },
    etag: String(head?.ETag || headers.etag || ''),
    versionId: String(head?.VersionId || headers['x-cos-version-id'] || '')
  };
}

function buildReceipt(config, uploadResult) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    backupId: config.backupId,
    createdAt: config.createdAt,
    databaseName: config.databaseName,
    sourceServerUuid: config.sourceServerUuid,
    artifact: {
      absolutePath: config.filePath,
      filename: path.basename(config.filePath),
      bytes: config.size,
      sha256: config.sha256
    },
    cos: {
      bucket: config.bucket,
      region: config.region,
      objectKey: config.objectKey,
      headMetadata: uploadResult.headMetadata,
      etag: uploadResult.etag,
      versionId: uploadResult.versionId,
      uploaderCredentialIdSha256: crypto.createHash('sha256')
        .update(config.secretId)
        .digest('hex')
    },
    dumpProfileVersion: config.dumpProfileVersion
  };
}

function writeReceiptAtomic(receiptPath, receipt, fileSystem = fs) {
  const partPath = `${receiptPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.part`;
  let descriptor;
  try {
    descriptor = fileSystem.openSync(partPath, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = undefined;
    fileSystem.chmodSync(partPath, 0o600);
    fileSystem.renameSync(partPath, receiptPath);
    fileSystem.chmodSync(receiptPath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fileSystem.closeSync(descriptor); } catch (_closeError) {}
    }
    try { fileSystem.unlinkSync(partPath); } catch (_unlinkError) {}
    throw new BackupCosError(
      'COS_BACKUP_RECEIPT_WRITE_FAILED',
      '备份 receipt 原子写入失败',
      EXIT_CODES.VERIFY,
      error
    );
  }
  return receiptPath;
}

function safeErrorCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.code || '')
    ? error.code
    : 'COS_BACKUP_UNEXPECTED_ERROR';
}

async function main({ env = process.env, output = console, COSClass } = {}) {
  try {
    const config = loadConfig(env);
    const client = createClient(config, COSClass);
    const result = await uploadAndVerify({ config, client });
    const receipt = buildReceipt(config, result);
    writeReceiptAtomic(config.receiptPath, receipt);
    output.log(JSON.stringify({
      ok: true,
      code: 'COS_BACKUP_VERIFIED_RECEIPT_WRITTEN',
      backupId: receipt.backupId,
      receiptPath: config.receiptPath,
      artifactSha256: config.sha256,
      objectKeyId: crypto.createHash('sha256').update(config.objectKey).digest('hex').slice(0, 12)
    }));
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const exitCode = [EXIT_CODES.CONFIG, EXIT_CODES.UPLOAD, EXIT_CODES.VERIFY]
      .includes(error?.exitCode)
      ? error.exitCode
      : EXIT_CODES.UNEXPECTED;
    output.error(`[${safeErrorCode(error)}] COS 备份上传或校验失败`);
    return exitCode;
  }
}

if (require.main === module) {
  require('dotenv').config();
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  EXIT_CODES,
  RECEIPT_SCHEMA_VERSION,
  DUMP_PROFILE_VERSION,
  createBackupId,
  BackupCosError,
  loadConfig,
  createClient,
  normalizeHeaders,
  uploadAndVerify,
  buildReceipt,
  writeReceiptAtomic,
  main
};
