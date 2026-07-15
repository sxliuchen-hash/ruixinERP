'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');
const path = require('path');
const stream = require('stream');
const util = require('util');
const zlib = require('zlib');

const pipeline = util.promisify(stream.pipeline);
const TEMP_PREFIX = 'erp-db-restore-smoke-';
const TARGET_DATABASE_PREFIX = 'erp_restore_smoke_';
const CONTAINER_PREFIX = 'erp-db-restore-smoke-';
const CONTAINER_LABEL = 'erp.restore-smoke.run';
const TARGET_CNF_PATH = '/tmp/erp-restore-smoke.cnf';
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 300000;
const RECEIPT_SCHEMA_VERSION = 1;
const DUMP_PROFILE_VERSION = 'erp-db-full-v1';
const RECEIPT_SUFFIX = '.receipt.json';
const MAX_RECEIPT_BYTES = 64 * 1024;

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  SOURCE_ACCESS: 3,
  DUMP: 4,
  RESTORE: 5,
  VERIFICATION: 6,
  CLEANUP: 7
});

const READ_ONLY_PRIVILEGES = new Set([
  'USAGE',
  'SELECT',
  'SHOW VIEW',
  'TRIGGER',
  'EVENT',
  'SHOW_ROUTINE'
]);

const CRITICAL_UNIQUE_INDEXES = Object.freeze([
  ['employees', 'uk_employees_user_id', 'user_id'],
  ['contracts', 'uk_contracts_sp_no', 'sp_no'],
  ['payments', 'uk_payments_sp_no', 'sp_no'],
  ['expenses', 'uk_expenses_sp_no', 'sp_no'],
  ['performance_imports', 'uk_performance_imports_confirmed_period', 'confirmed_period_key']
]);

const METADATA_SPECS = Object.freeze({
  objects: {
    columns: ['table_name', 'table_type', 'engine'],
    from: 'information_schema.tables',
    where: 'table_schema = DATABASE()',
    order: 'table_name, table_type'
  },
  columns: {
    columns: [
      'table_name', 'ordinal_position', 'column_name', 'column_type', 'is_nullable',
      'column_default', 'extra', 'generation_expression', 'character_set_name', 'collation_name'
    ],
    from: 'information_schema.columns',
    where: 'table_schema = DATABASE()',
    order: 'table_name, ordinal_position'
  },
  indexes: {
    columns: [
      'table_name', 'index_name', 'non_unique', 'seq_in_index', 'column_name',
      'collation', 'sub_part', 'index_type', 'is_visible', 'expression'
    ],
    from: 'information_schema.statistics',
    where: 'table_schema = DATABASE()',
    order: 'table_name, index_name, seq_in_index'
  },
  constraints: {
    columns: [
      'tc.table_name AS table_name', 'tc.constraint_name AS constraint_name',
      'tc.constraint_type AS constraint_type', 'kcu.ordinal_position AS ordinal_position',
      'kcu.column_name AS column_name', 'kcu.referenced_table_name AS referenced_table_name',
      'kcu.referenced_column_name AS referenced_column_name',
      'rc.update_rule AS update_rule', 'rc.delete_rule AS delete_rule',
      'cc.check_clause AS check_clause', 'tc.enforced AS enforced'
    ],
    keys: [
      'table_name', 'constraint_name', 'constraint_type', 'ordinal_position', 'column_name',
      'referenced_table_name', 'referenced_column_name', 'update_rule', 'delete_rule',
      'check_clause', 'enforced'
    ],
    from: `information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
       AND kcu.table_name = tc.table_name
       AND kcu.constraint_name = tc.constraint_name
      LEFT JOIN information_schema.referential_constraints rc
        ON rc.constraint_schema = tc.constraint_schema
       AND rc.table_name = tc.table_name
       AND rc.constraint_name = tc.constraint_name
      LEFT JOIN information_schema.check_constraints cc
        ON cc.constraint_schema = tc.constraint_schema
       AND cc.constraint_name = tc.constraint_name`,
    where: 'tc.constraint_schema = DATABASE()',
    order: 'tc.table_name, tc.constraint_name, kcu.ordinal_position'
  },
  triggers: {
    columns: [
      'trigger_name', 'event_manipulation', 'event_object_table', 'action_timing',
      'action_orientation', 'action_order', 'action_condition', 'action_statement', 'sql_mode',
      'character_set_client', 'collation_connection', 'database_collation'
    ],
    from: 'information_schema.triggers',
    where: 'trigger_schema = DATABASE()',
    order: 'trigger_name'
  },
  routines: {
    columns: [
      'r.routine_name AS routine_name', 'r.specific_name AS specific_name',
      'r.routine_type AS routine_type', 'r.data_type AS return_data_type',
      'r.dtd_identifier AS return_dtd_identifier', 'r.routine_definition AS routine_definition',
      'r.is_deterministic AS is_deterministic', 'r.sql_data_access AS sql_data_access',
      'r.security_type AS security_type', 'r.sql_mode AS sql_mode',
      'p.ordinal_position AS parameter_ordinal_position', 'p.parameter_mode AS parameter_mode',
      'p.parameter_name AS parameter_name', 'p.data_type AS parameter_data_type',
      'p.dtd_identifier AS parameter_dtd_identifier'
    ],
    keys: [
      'routine_name', 'specific_name', 'routine_type', 'return_data_type',
      'return_dtd_identifier', 'routine_definition', 'is_deterministic', 'sql_data_access',
      'security_type', 'sql_mode', 'parameter_ordinal_position', 'parameter_mode',
      'parameter_name', 'parameter_data_type', 'parameter_dtd_identifier'
    ],
    from: `information_schema.routines r
      LEFT JOIN information_schema.parameters p
        ON p.specific_schema = r.routine_schema
       AND p.specific_name = r.specific_name`,
    where: 'r.routine_schema = DATABASE()',
    order: 'r.routine_type, r.routine_name, p.ordinal_position'
  },
  events: {
    columns: [
      'event_name', 'event_definition', 'event_type', 'execute_at', 'interval_value',
      'interval_field', 'starts', 'ends', 'status', 'on_completion', 'sql_mode',
      'time_zone', 'character_set_client', 'collation_connection', 'database_collation'
    ],
    from: 'information_schema.events',
    where: 'event_schema = DATABASE()',
    order: 'event_name'
  }
});

class DbRestoreSmokeError extends Error {
  constructor(code, message, exitCode, cause) {
    super(message);
    this.name = 'DbRestoreSmokeError';
    this.code = code;
    this.exitCode = exitCode;
    this.isOperational = true;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, exitCode, cause) {
  throw new DbRestoreSmokeError(code, message, exitCode, cause);
}

function requiredValue(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value || /^<.*>$/.test(value) || /^your[_-]/i.test(value)) {
    fail('DB_RESTORE_CONFIG_MISSING', `缺少独立备份源配置 ${name}`, EXIT_CODES.CONFIG);
  }
  return value;
}

function hasAsciiControl(value) {
  return [...String(value)].some((character) => character.charCodeAt(0) <= 31);
}

function hasNullCrLf(value) {
  return [...String(value)].some((character) => [0, 10, 13].includes(character.charCodeAt(0)));
}

function findForbiddenTargetVariables(env) {
  return Object.keys(env).filter((name) => (
    /^(?:DB_(?:RESTORE|TARGET|DESTINATION)|TARGET_DB|RESTORE_DB)_(?:HOST|PORT|DATABASE|DB|NAME)$/i.test(name) ||
    /^DB_RESTORE_SMOKE_TARGET_(?:HOST|PORT|DATABASE|DB|NAME)$/i.test(name) ||
    /(?:RESTORE|TARGET|DESTINATION).*(?:HOST|PORT|DATABASE|_DB|_NAME)$/i.test(name)
  ));
}

function loadConfig(env = process.env) {
  if (env.ALLOW_DB_RESTORE_SMOKE !== 'YES') {
    fail(
      'DB_RESTORE_EXPLICIT_CONSENT_REQUIRED',
      '必须显式设置 ALLOW_DB_RESTORE_SMOKE=YES',
      EXIT_CODES.CONFIG
    );
  }
  const forbidden = findForbiddenTargetVariables(env);
  if (forbidden.length > 0) {
    fail(
      'DB_RESTORE_TARGET_ENV_FORBIDDEN',
      '禁止通过环境变量指定恢复目标 host、port 或 database',
      EXIT_CODES.CONFIG
    );
  }

  const portText = requiredValue(env, 'DB_BACKUP_PORT');
  if (!/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    fail('DB_RESTORE_SOURCE_PORT_INVALID', 'DB_BACKUP_PORT 格式无效', EXIT_CODES.CONFIG);
  }
  const database = requiredValue(env, 'DB_BACKUP_NAME');
  const user = requiredValue(env, 'DB_BACKUP_USER');
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(database)) {
    fail('DB_RESTORE_SOURCE_DATABASE_INVALID', 'DB_BACKUP_DATABASE 格式无效', EXIT_CODES.CONFIG);
  }
  if (!/^[A-Za-z0-9_$@.-]{1,128}$/.test(user)) {
    fail('DB_RESTORE_SOURCE_USER_INVALID', 'DB_BACKUP_USER 格式无效', EXIT_CODES.CONFIG);
  }
  const applicationUser = typeof env.DB_USER === 'string' ? env.DB_USER.trim() : '';
  if (applicationUser && applicationUser.toLowerCase() === user.toLowerCase()) {
    fail(
      'DB_RESTORE_APPLICATION_USER_FORBIDDEN',
      '备份 smoke 禁止使用应用 DB_USER',
      EXIT_CODES.CONFIG
    );
  }
  const image = requiredValue(env, 'DB_RESTORE_MYSQL_IMAGE');
  const imageMatch = /^mysql:(\d+\.\d+(?:\.\d+)?)@sha256:([a-f0-9]{64})$/.exec(image);
  if (!imageMatch) {
    fail(
      'DB_RESTORE_IMAGE_NOT_PINNED',
      'DB_RESTORE_MYSQL_IMAGE 必须为 mysql:<version>@sha256:<64hex>',
      EXIT_CODES.CONFIG
    );
  }

  const host = requiredValue(env, 'DB_BACKUP_HOST');
  const password = requiredValue(env, 'DB_BACKUP_PASSWORD');
  const backupDirInput = requiredValue(env, 'BACKUP_DIR');
  const receiptPathInput = requiredValue(env, 'DB_RESTORE_RECEIPT_PATH');
  const timeoutText = String(env.DB_RESTORE_COMMAND_TIMEOUT_MS || DEFAULT_COMMAND_TIMEOUT_MS);
  const artifactSource = String(env.DB_RESTORE_ARTIFACT_SOURCE || 'local').trim().toLowerCase();
  if (host.length > 255 || /\s/.test(host) || hasAsciiControl(host)) {
    fail('DB_RESTORE_SOURCE_HOST_INVALID', 'DB_BACKUP_HOST 格式无效', EXIT_CODES.CONFIG);
  }
  if (hasNullCrLf(password)) {
    fail('DB_RESTORE_SOURCE_PASSWORD_INVALID', 'DB_BACKUP_PASSWORD 包含不允许的控制字符', EXIT_CODES.CONFIG);
  }
  if (!/^\d+$/.test(timeoutText) || Number(timeoutText) < 1000 || Number(timeoutText) > 3600000) {
    fail(
      'DB_RESTORE_TIMEOUT_INVALID',
      'DB_RESTORE_COMMAND_TIMEOUT_MS 必须是 1000-3600000 的整数',
      EXIT_CODES.CONFIG
    );
  }
  if (!['local', 'cos'].includes(artifactSource)) {
    fail(
      'DB_RESTORE_ARTIFACT_SOURCE_INVALID',
      'DB_RESTORE_ARTIFACT_SOURCE 只允许 local 或 cos',
      EXIT_CODES.CONFIG
    );
  }

  let cosRestore = null;
  if (artifactSource === 'cos') {
    const secretId = requiredValue(env, 'COS_BACKUP_RESTORE_SECRET_ID');
    const secretKey = requiredValue(env, 'COS_BACKUP_RESTORE_SECRET_KEY');
    const securityToken = typeof env.COS_BACKUP_RESTORE_SECURITY_TOKEN === 'string'
      ? env.COS_BACKUP_RESTORE_SECURITY_TOKEN.trim()
      : '';
    if (
      (env.COS_BACKUP_SECRET_ID && secretId === String(env.COS_BACKUP_SECRET_ID).trim()) ||
      (env.COS_BACKUP_SECRET_KEY && secretKey === String(env.COS_BACKUP_SECRET_KEY).trim())
    ) {
      fail(
        'DB_RESTORE_COS_CREDENTIAL_REUSED',
        '远端恢复只读凭证不得复用日常备份上传凭证',
        EXIT_CODES.CONFIG
      );
    }
    cosRestore = Object.freeze({ secretId, secretKey, securityToken });
  }

  if (!path.isAbsolute(backupDirInput) || !path.isAbsolute(receiptPathInput)) {
    fail(
      'DB_RESTORE_RECEIPT_PATH_NOT_ABSOLUTE',
      'BACKUP_DIR 和 DB_RESTORE_RECEIPT_PATH 必须是绝对路径',
      EXIT_CODES.CONFIG
    );
  }
  const rawSegments = receiptPathInput.replace(/\\/g, '/').split('/').filter(Boolean);
  if (
    /[*?[\]{}]/.test(receiptPathInput) ||
    rawSegments.some((segment) => ['..', 'latest', 'list'].includes(segment.toLowerCase()))
  ) {
    fail(
      'DB_RESTORE_RECEIPT_SELECTOR_FORBIDDEN',
      'receipt 路径禁止使用 latest、list、通配或上级目录选择器',
      EXIT_CODES.CONFIG
    );
  }
  const backupDir = path.resolve(backupDirInput);
  const receiptPath = path.resolve(receiptPathInput);
  const receiptRelative = path.relative(backupDir, receiptPath);
  if (
    receiptRelative.startsWith('..') ||
    path.isAbsolute(receiptRelative) ||
    path.dirname(receiptRelative) !== '.' ||
    !/^erp_db_\d{8}_\d{6}\.sql\.gz\.receipt\.json$/.test(path.basename(receiptPath))
  ) {
    fail(
      'DB_RESTORE_RECEIPT_SCOPE_INVALID',
      'receipt 必须是 BACKUP_DIR 内固定命名的直属文件',
      EXIT_CODES.CONFIG
    );
  }

  return Object.freeze({
    source: Object.freeze({
      host,
      port: Number(portText),
      database,
      user,
      password
    }),
    image,
    mysqlVersion: imageMatch[1],
    commandTimeoutMs: Number(timeoutText),
    backupDir,
    receiptPath,
    artifactSource,
    cosRestore
  });
}

function randomId(randomBytes = crypto.randomBytes) {
  return randomBytes(12).toString('hex');
}

function createRunContext(randomBytes = crypto.randomBytes) {
  const id = randomId(randomBytes);
  const rootPassword = randomBytes(32).toString('base64url');
  return Object.freeze({
    id,
    containerName: `${CONTAINER_PREFIX}${id}`,
    targetDatabase: `${TARGET_DATABASE_PREFIX}${id}`,
    rootPassword,
    label: `${CONTAINER_LABEL}=${id}`
  });
}

function buildDockerRunArgs(config, context, envFile) {
  return [
    'run', '-d',
    '--name', context.containerName,
    '--label', context.label,
    '--network', 'none',
    '--pull', 'never',
    '--env-file', envFile,
    config.image,
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_0900_ai_ci'
  ];
}

function quoteCnfValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n|\r/g, '')}"`;
}

function sourceCnfContents(source) {
  return [
    '[client]',
    `host=${quoteCnfValue(source.host)}`,
    `port=${source.port}`,
    `user=${quoteCnfValue(source.user)}`,
    `password=${quoteCnfValue(source.password)}`,
    'default-character-set=utf8mb4',
    ''
  ].join('\n');
}

function targetCnfContents(context) {
  return [
    '[client]',
    'host=localhost',
    'user=root',
    `password=${quoteCnfValue(context.rootPassword)}`,
    'default-character-set=utf8mb4',
    ''
  ].join('\n');
}

async function writePrivateFile(filePath, contents, deps = {}) {
  const fsApi = deps.fsPromises || fsPromises;
  await fsApi.writeFile(filePath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsApi.chmod(filePath, 0o600);
}

async function assertPrivateRegularFile(
  filePath,
  label,
  fsApi = fsPromises,
  platform = process.platform
) {
  let stats;
  try {
    stats = await fsApi.lstat(filePath);
  } catch (error) {
    fail('DB_RESTORE_ARTIFACT_UNAVAILABLE', `${label} 不存在或不可读`, EXIT_CODES.DUMP, error);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail('DB_RESTORE_SYMLINK_FORBIDDEN', `${label} 必须是普通文件且不得为符号链接`, EXIT_CODES.CONFIG);
  }
  // Windows 的 stat mode 不反映 NTFS ACL；生产部署为 Linux，Linux 下严格
  // 要求 0600。Windows 单元测试通过注入 linux platform 覆盖此门禁。
  if (platform !== 'win32' && (stats.mode & 0o777) !== 0o600) {
    fail('DB_RESTORE_FILE_MODE_INVALID', `${label} 权限必须严格为 0600`, EXIT_CODES.CONFIG);
  }
  return stats;
}

function validateReceiptShape(receipt, config) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    fail('DB_RESTORE_RECEIPT_INVALID', 'receipt 必须是 JSON 对象', EXIT_CODES.CONFIG);
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    fail('DB_RESTORE_RECEIPT_SCHEMA_UNSUPPORTED', 'receipt schemaVersion 不受支持', EXIT_CODES.CONFIG);
  }
  if (!/^erp-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(String(receipt.backupId || ''))) {
    fail('DB_RESTORE_RECEIPT_BACKUP_ID_INVALID', 'receipt backupId 格式不合法', EXIT_CODES.CONFIG);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(receipt.createdAt || '')) ||
      Number.isNaN(Date.parse(receipt.createdAt))) {
    fail('DB_RESTORE_RECEIPT_CREATED_AT_INVALID', 'receipt createdAt 格式不合法', EXIT_CODES.CONFIG);
  }
  if (receipt.databaseName !== config.source.database) {
    fail('DB_RESTORE_RECEIPT_DATABASE_MISMATCH', 'receipt databaseName 与 DB_BACKUP_NAME 不一致', EXIT_CODES.CONFIG);
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(receipt.sourceServerUuid || ''))) {
    fail('DB_RESTORE_RECEIPT_SOURCE_UUID_INVALID', 'receipt sourceServerUuid 格式不合法', EXIT_CODES.CONFIG);
  }
  if (receipt.dumpProfileVersion !== DUMP_PROFILE_VERSION) {
    fail('DB_RESTORE_RECEIPT_DUMP_PROFILE_INVALID', 'receipt dumpProfileVersion 不受支持', EXIT_CODES.CONFIG);
  }

  const artifact = receipt.artifact;
  const cos = receipt.cos;
  const expectedArtifactPath = config.receiptPath.slice(0, -RECEIPT_SUFFIX.length);
  if (
    !artifact ||
    artifact.absolutePath !== expectedArtifactPath ||
    artifact.filename !== path.basename(expectedArtifactPath) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))
  ) {
    fail('DB_RESTORE_RECEIPT_ARTIFACT_INVALID', 'receipt artifact 契约不合法', EXIT_CODES.CONFIG);
  }
  if (
    !cos ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/i.test(String(cos.bucket || '')) ||
    !/^[a-z0-9-]+$/i.test(String(cos.region || '')) ||
    cos.objectKey !== `erp-backups/db/${artifact.filename}` ||
    !cos.headMetadata ||
    Number(cos.headMetadata.contentLength) !== artifact.bytes ||
    cos.headMetadata.sha256 !== artifact.sha256 ||
    typeof cos.etag !== 'string' || cos.etag.length > 512 || /[\r\n]/.test(cos.etag) ||
    typeof cos.versionId !== 'string' || cos.versionId.length > 512 || /[\r\n]/.test(cos.versionId) ||
    !/^[a-f0-9]{64}$/.test(String(cos.uploaderCredentialIdSha256 || ''))
  ) {
    fail('DB_RESTORE_RECEIPT_COS_INVALID', 'receipt COS HEAD 契约不合法', EXIT_CODES.CONFIG);
  }
  if (
    config.artifactSource === 'cos' &&
    crypto.createHash('sha256').update(config.cosRestore.secretId).digest('hex') ===
      cos.uploaderCredentialIdSha256
  ) {
    fail(
      'DB_RESTORE_COS_CREDENTIAL_REUSED',
      '远端恢复只读凭证不得复用 receipt 记录的上传凭证',
      EXIT_CODES.CONFIG
    );
  }
  return receipt;
}

async function loadAndValidateReceipt(config, deps = {}) {
  const fsApi = deps.fsPromises || fsPromises;
  const platform = deps.platform || process.platform;
  let backupDirStats;
  try {
    backupDirStats = await fsApi.lstat(config.backupDir);
  } catch (error) {
    fail('DB_RESTORE_BACKUP_DIR_UNAVAILABLE', 'BACKUP_DIR 不存在或不可读', EXIT_CODES.CONFIG, error);
  }
  if (
    !backupDirStats.isDirectory() ||
    backupDirStats.isSymbolicLink() ||
    (platform !== 'win32' && (backupDirStats.mode & 0o077) !== 0)
  ) {
    fail('DB_RESTORE_BACKUP_DIR_UNSAFE', 'BACKUP_DIR 必须是非符号链接且禁止组/其他用户访问', EXIT_CODES.CONFIG);
  }
  const receiptStats = await assertPrivateRegularFile(config.receiptPath, 'receipt', fsApi, platform);
  if (receiptStats.size <= 0 || receiptStats.size > MAX_RECEIPT_BYTES) {
    fail('DB_RESTORE_RECEIPT_SIZE_INVALID', 'receipt 大小超出安全范围', EXIT_CODES.CONFIG);
  }
  let receipt;
  try {
    receipt = JSON.parse(await fsApi.readFile(config.receiptPath, 'utf8'));
  } catch (error) {
    fail('DB_RESTORE_RECEIPT_JSON_INVALID', 'receipt 不是有效 JSON', EXIT_CODES.CONFIG, error);
  }
  validateReceiptShape(receipt, config);
  let realBackupDir;
  let realReceipt;
  try {
    [realBackupDir, realReceipt] = await Promise.all([
      fsApi.realpath(config.backupDir),
      fsApi.realpath(config.receiptPath)
    ]);
  } catch (error) {
    fail('DB_RESTORE_REALPATH_FAILED', '无法确认 receipt 真实路径', EXIT_CODES.CONFIG, error);
  }
  if (realReceipt !== path.join(realBackupDir, path.basename(config.receiptPath))) {
    fail('DB_RESTORE_REALPATH_SCOPE_INVALID', 'receipt 真实路径超出 BACKUP_DIR', EXIT_CODES.CONFIG);
  }

  if (config.artifactSource === 'cos') {
    return Object.freeze({ receipt, artifactPath: null, verifiedArtifact: null });
  }

  const artifactPath = receipt.artifact.absolutePath;
  const artifactStats = await assertPrivateRegularFile(artifactPath, '备份工件', fsApi, platform);
  if (artifactStats.size !== receipt.artifact.bytes) {
    fail('DB_RESTORE_ARTIFACT_SIZE_MISMATCH', '备份工件大小与 receipt 不一致', EXIT_CODES.DUMP);
  }
  let realArtifact;
  try {
    realArtifact = await fsApi.realpath(artifactPath);
  } catch (error) {
    fail('DB_RESTORE_REALPATH_FAILED', '无法确认 receipt 或工件真实路径', EXIT_CODES.CONFIG, error);
  }
  if (
    realArtifact !== path.join(realBackupDir, path.basename(artifactPath))
  ) {
    fail('DB_RESTORE_REALPATH_SCOPE_INVALID', 'receipt 或工件真实路径超出 BACKUP_DIR', EXIT_CODES.CONFIG);
  }
  const verifiedArtifact = await verifyGzipAndHash(artifactPath);
  if (
    verifiedArtifact.compressedBytes !== receipt.artifact.bytes ||
    verifiedArtifact.sha256 !== receipt.artifact.sha256
  ) {
    fail('DB_RESTORE_ARTIFACT_SHA256_MISMATCH', '备份工件 SHA256 与 receipt 不一致', EXIT_CODES.DUMP);
  }
  return Object.freeze({ receipt, artifactPath, verifiedArtifact });
}

function assertReceiptSourceServerUuid(receiptUuid, currentUuid) {
  if (String(receiptUuid).toLowerCase() !== String(currentUuid).trim().toLowerCase()) {
    fail('DB_RESTORE_SOURCE_UUID_RECEIPT_MISMATCH', '当前源库 server_uuid 与 receipt 不一致', EXIT_CODES.SOURCE_ACCESS);
  }
  return true;
}

function createCosRestoreClient(config, COSClass) {
  const COS = COSClass || require('cos-nodejs-sdk-v5');
  const options = {
    SecretId: config.secretId,
    SecretKey: config.secretKey
  };
  if (config.securityToken) options.SecurityToken = config.securityToken;
  return new COS(options);
}

async function downloadCosReceiptArtifact({
  config,
  receipt,
  destinationPath,
  client,
  tempDir,
  tmpRoot = os.tmpdir(),
  fileSystem = fs,
  fsApi = fsPromises,
  platform = process.platform
}) {
  assertSafeTempDir(tempDir, tmpRoot);
  if (path.resolve(destinationPath) !== path.join(path.resolve(tempDir), 'cos-artifact.sql.gz')) {
    fail('DB_RESTORE_COS_DESTINATION_INVALID', 'COS 下载目标必须位于本次临时目录', EXIT_CODES.CONFIG);
  }
  if (!client || typeof client.getObject !== 'function') {
    fail('DB_RESTORE_COS_CLIENT_INVALID', 'COS 恢复客户端不可用', EXIT_CODES.CONFIG);
  }
  const outputStream = fileSystem.createWriteStream(destinationPath, {
    flags: 'wx',
    mode: 0o600
  });
  const params = {
    Bucket: receipt.cos.bucket,
    Region: receipt.cos.region,
    Key: receipt.cos.objectKey,
    Output: outputStream
  };
  if (receipt.cos.versionId) params.VersionId = receipt.cos.versionId;
  if (receipt.cos.etag) params.IfMatch = receipt.cos.etag;

  let response;
  try {
    response = await new Promise((resolve, reject) => {
      let callbackDone = false;
      let callbackData;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const maybeFinish = () => {
        if (callbackDone && outputStream.writableFinished) finish(null, callbackData || {});
      };
      const timer = setTimeout(() => {
        outputStream.destroy();
        finish(new Error('COS getObject timed out'));
      }, config.commandTimeoutMs);
      outputStream.once('error', (error) => finish(error));
      outputStream.once('finish', maybeFinish);
      try {
        client.getObject(params, (error, data) => {
          if (error) {
            outputStream.destroy();
            finish(error);
            return;
          }
          callbackDone = true;
          callbackData = data;
          maybeFinish();
        });
      } catch (error) {
        outputStream.destroy();
        finish(error);
      }
    });
  } catch (error) {
    if (!outputStream.destroyed) outputStream.destroy();
    if (!outputStream.closed) {
      await new Promise((resolve) => outputStream.once('close', resolve));
    }
    await fsApi.unlink(destinationPath).catch(() => {});
    fail('DB_RESTORE_COS_DOWNLOAD_FAILED', 'COS 精确工件下载失败', EXIT_CODES.DUMP, error);
  }

  if (
    receipt.cos.versionId &&
    response?.VersionId &&
    response.VersionId !== receipt.cos.versionId
  ) {
    await fsApi.unlink(destinationPath).catch(() => {});
    fail('DB_RESTORE_COS_VERSION_MISMATCH', 'COS 返回版本与 receipt 不一致', EXIT_CODES.DUMP);
  }
  await fsApi.chmod(destinationPath, 0o600);
  const stats = await assertPrivateRegularFile(destinationPath, 'COS 下载工件', fsApi, platform);
  if (stats.size !== receipt.artifact.bytes) {
    await fsApi.unlink(destinationPath).catch(() => {});
    fail('DB_RESTORE_COS_SIZE_MISMATCH', 'COS 下载工件大小与 receipt 不一致', EXIT_CODES.DUMP);
  }
  let verifiedArtifact;
  try {
    verifiedArtifact = await verifyGzipAndHash(destinationPath);
  } catch (error) {
    await fsApi.unlink(destinationPath).catch(() => {});
    throw error;
  }
  if (
    verifiedArtifact.compressedBytes !== receipt.artifact.bytes ||
    verifiedArtifact.sha256 !== receipt.artifact.sha256
  ) {
    await fsApi.unlink(destinationPath).catch(() => {});
    fail('DB_RESTORE_COS_SHA256_MISMATCH', 'COS 下载工件 SHA256 与 receipt 不一致', EXIT_CODES.DUMP);
  }
  return Object.freeze({ artifactPath: destinationPath, verifiedArtifact, response });
}

function parseGrant(grant) {
  const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i.exec(grant.trim());
  if (!match) {
    fail('DB_RESTORE_GRANT_UNPARSEABLE', '无法解析备份账号 SHOW GRANTS', EXIT_CODES.SOURCE_ACCESS);
  }
  if (/\bWITH\s+GRANT\s+OPTION\b/i.test(grant) || /^GRANT\s+PROXY\b/i.test(grant)) {
    fail('DB_RESTORE_SOURCE_PRIVILEGE_FORBIDDEN', '备份账号包含授权或代理权限', EXIT_CODES.SOURCE_ACCESS);
  }
  return {
    privileges: match[1].split(',').map((item) => (
      item.trim().replace(/`/g, '').replace(/\s+/g, ' ').toUpperCase()
    )),
    scope: match[2].trim().replace(/`/g, '').toLowerCase()
  };
}

function tokenizeGrantPrivileges(grant) {
  return parseGrant(grant).privileges;
}

function validateReadOnlyGrants(grants, expectedDatabase = '') {
  if (!Array.isArray(grants) || grants.length === 0) {
    fail('DB_RESTORE_GRANTS_MISSING', '备份账号未返回 SHOW GRANTS', EXIT_CODES.SOURCE_ACCESS);
  }
  for (const grant of grants) {
    const { privileges, scope } = parseGrant(String(grant));
    for (const privilege of privileges) {
      if (privilege === 'ALL' || privilege === 'ALL PRIVILEGES' || !READ_ONLY_PRIVILEGES.has(privilege)) {
        fail(
          'DB_RESTORE_SOURCE_PRIVILEGE_FORBIDDEN',
          `备份账号包含非只读白名单权限：${privilege}`,
          EXIT_CODES.SOURCE_ACCESS
        );
      }
      if (expectedDatabase) {
        const expectedScope = `${String(expectedDatabase).toLowerCase()}.*`;
        const globalOnly = privilege === 'USAGE' || privilege === 'SHOW_ROUTINE';
        if ((globalOnly && scope !== '*.*') || (!globalOnly && scope !== expectedScope)) {
          fail(
            'DB_RESTORE_SOURCE_SCOPE_FORBIDDEN',
            '备份账号权限范围超出或不匹配指定 ERP 数据库',
            EXIT_CODES.SOURCE_ACCESS
          );
        }
      }
    }
  }
  return true;
}

function assertDifferentServerUuids(sourceUuid, targetUuid) {
  const source = String(sourceUuid || '').trim();
  const target = String(targetUuid || '').trim();
  if (!source || !target) {
    fail('DB_RESTORE_SERVER_UUID_MISSING', '源或目标 server_uuid 为空', EXIT_CODES.VERIFICATION);
  }
  if (source.toLowerCase() === target.toLowerCase()) {
    fail('DB_RESTORE_SERVER_UUID_MATCH', '源库与恢复目标 server_uuid 相同', EXIT_CODES.VERIFICATION);
  }
  return true;
}

function dangerousTokenError(tokens) {
  const last = tokens[tokens.length - 1];
  const previous = tokens[tokens.length - 2];
  if (last === 'USE' || last === 'GRANT') return last;
  if (
    (previous === 'CREATE' && ['DATABASE', 'SCHEMA', 'USER'].includes(last)) ||
    (previous === 'DROP' && ['DATABASE', 'SCHEMA'].includes(last)) ||
    (previous === 'SET' && last === 'GLOBAL')
  ) return `${previous} ${last}`;
  return '';
}

class SqlSafetyTransform extends stream.Transform {
  constructor() {
    super();
    this.quote = '';
    this.escaped = false;
    this.lineComment = false;
    this.blockComment = false;
    this.blockCommentAwaitKind = false;
    this.blockCommentStar = false;
    this.executableComment = false;
    this.executableCommentStar = false;
    this.pendingSlash = false;
    this.pendingDashes = 0;
    this.token = '';
    this.tokens = [];
    this.plainBytes = 0;
  }

  _flushToken() {
    if (!this.token) return;
    this.tokens.push(this.token.toUpperCase());
    if (this.tokens.length > 2) this.tokens.shift();
    const dangerous = dangerousTokenError(this.tokens);
    this.token = '';
    if (dangerous) {
      fail(
        'DB_RESTORE_DANGEROUS_SQL',
        `备份流包含禁止语句 ${dangerous}`,
        EXIT_CODES.DUMP
      );
    }
  }

  _scan(text) {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1] || '';
      if (this.lineComment) {
        if (character === '\n') this.lineComment = false;
        continue;
      }
      if (this.blockComment) {
        if (this.blockCommentAwaitKind) {
          this.blockCommentAwaitKind = false;
          if (character === '!') {
            this.blockComment = false;
            this.executableComment = true;
            continue;
          }
        }
        if (this.blockCommentStar && character === '/') {
          this.blockComment = false;
          this.blockCommentStar = false;
          continue;
        }
        this.blockCommentStar = character === '*';
        continue;
      }
      if (this.executableComment && !this.quote) {
        if (this.executableCommentStar && character === '/') {
          this._flushToken();
          this.executableComment = false;
          this.executableCommentStar = false;
          continue;
        }
        this.executableCommentStar = false;
        if (character === '*') {
          this._flushToken();
          this.executableCommentStar = true;
          continue;
        }
      }
      if (this.quote) {
        if (this.escaped) {
          this.escaped = false;
        } else if (character === '\\') {
          this.escaped = true;
        } else if (character === this.quote) {
          if (next === this.quote) index += 1;
          else this.quote = '';
        }
        continue;
      }
      if (this.pendingSlash) {
        this.pendingSlash = false;
        if (character === '*') {
          this.blockComment = true;
          this.blockCommentAwaitKind = true;
          this.blockCommentStar = false;
          continue;
        }
      }
      if (this.pendingDashes > 0) {
        if (this.pendingDashes === 1 && character === '-') {
          this.pendingDashes = 2;
          continue;
        }
        if (this.pendingDashes === 2 && /\s/.test(character)) {
          this.pendingDashes = 0;
          this.lineComment = character !== '\n';
          continue;
        }
        this.pendingDashes = 0;
      }
      if (character === '/') {
        this._flushToken();
        this.pendingSlash = true;
        continue;
      }
      if (character === '-') {
        this._flushToken();
        this.pendingDashes = 1;
        continue;
      }
      if (character === '#') {
        this._flushToken();
        this.lineComment = true;
        continue;
      }
      if (character === '\'' || character === '"' || character === '`') {
        this._flushToken();
        this.quote = character;
        continue;
      }
      if (/[A-Za-z_]/.test(character)) this.token += character;
      else this._flushToken();
    }
  }

  _transform(chunk, encoding, callback) {
    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      this.plainBytes += buffer.length;
      this._scan(buffer.toString('utf8'));
      callback(null, buffer);
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      this._flushToken();
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

function assertSqlSafe(chunks) {
  const scanner = new SqlSafetyTransform();
  for (const chunk of chunks) scanner._scan(String(chunk));
  scanner._flushToken();
  return true;
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function jsonObjectSql(columns, keys = columns) {
  return columns.map((column, index) => {
    const expression = column.includes(' AS ') ? column : column;
    return `'${keys[index]}', ${expression}`;
  }).join(', ');
}

function buildMetadataQuery(spec) {
  const keys = spec.keys || spec.columns.map((column) => column.replace(/^.*\s+AS\s+/i, ''));
  const selected = spec.columns.join(', ');
  return `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(${jsonObjectSql(keys, keys)})), JSON_ARRAY())
    FROM (SELECT ${selected} FROM ${spec.from} WHERE ${spec.where} ORDER BY ${spec.order}) metadata_rows`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  if (typeof value === 'number') return String(value);
  return value === undefined ? null : value;
}

function stableRows(rows) {
  return rows.map(canonicalize).sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

function compareSnapshots(source, target) {
  const sections = ['objects', 'rowCounts', 'columns', 'indexes', 'constraints', 'triggers', 'routines', 'events'];
  for (const section of sections) {
    const left = stableRows(source[section] || []);
    const right = stableRows(target[section] || []);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      fail(
        'DB_RESTORE_SNAPSHOT_MISMATCH',
        `恢复后 ${section} 与源库精确签名不一致`,
        EXIT_CODES.VERIFICATION
      );
    }
  }
  return true;
}

function assertSourceRowsUnchanged(beforeRows, afterRows) {
  if (JSON.stringify(stableRows(beforeRows || [])) !== JSON.stringify(stableRows(afterRows || []))) {
    fail(
      'DB_RESTORE_SOURCE_CHANGED',
      '演练期间源库全表精确行数发生变化',
      EXIT_CODES.VERIFICATION
    );
  }
  return true;
}

function assertCriticalStructures(snapshot) {
  const indexes = snapshot.indexes || [];
  for (const [tableName, indexName, columnName] of CRITICAL_UNIQUE_INDEXES) {
    const rows = indexes.filter((row) => (
      row.table_name === tableName && row.index_name === indexName
    ));
    if (
      rows.length !== 1 ||
      Number(rows[0].non_unique) !== 0 ||
      Number(rows[0].seq_in_index) !== 1 ||
      rows[0].column_name !== columnName
    ) {
      fail(
        'DB_RESTORE_CRITICAL_INDEX_MISSING',
        `关键单列唯一索引不符合契约：${tableName}.${indexName}`,
        EXIT_CODES.VERIFICATION
      );
    }
  }
  const generated = (snapshot.columns || []).find((row) => (
    row.table_name === 'performance_imports' && row.column_name === 'confirmed_period_key'
  ));
  if (
    !generated ||
    !/STORED\s+GENERATED/i.test(String(generated.extra || '')) ||
    !String(generated.generation_expression || '').trim()
  ) {
    fail(
      'DB_RESTORE_GENERATED_COLUMN_INVALID',
      'performance_imports.confirmed_period_key 不是 STORED 生成列',
      EXIT_CODES.VERIFICATION
    );
  }
  const accountId = (snapshot.columns || []).find((row) => (
    row.table_name === 'payments' && row.column_name === 'account_id'
  ));
  if (!accountId || String(accountId.is_nullable).toUpperCase() !== 'YES') {
    fail(
      'DB_RESTORE_PAYMENT_ACCOUNT_NOT_NULLABLE',
      'payments.account_id 必须允许 NULL',
      EXIT_CODES.VERIFICATION
    );
  }
  return true;
}

function assertInnoDbTables(snapshot) {
  const invalid = (snapshot.objects || []).filter((row) => (
    row.table_type === 'BASE TABLE' && String(row.engine || '').toUpperCase() !== 'INNODB'
  ));
  if (invalid.length > 0) {
    fail(
      'DB_RESTORE_NON_INNODB_TABLE',
      '源库或恢复库包含非 InnoDB 业务表',
      EXIT_CODES.VERIFICATION
    );
  }
  return true;
}

function defaultRunCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeoutMs = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(Object.assign(new Error(`${file} timed out`), { code: 'COMMAND_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_COMMAND_OUTPUT_BYTES) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_COMMAND_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(Object.assign(new Error(`${file} exited ${code}`), { command: file, exitCode: code }));
        return;
      }
      finish(null, {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function mysqlHostQuery(runCommand, cnfPath, database, sql) {
  const result = await runCommand('mysql', [
    `--defaults-extra-file=${cnfPath}`,
    `--database=${database}`,
    '--batch', '--raw', '--skip-column-names',
    '--execute', sql
  ]);
  return result.stdout.trim();
}

async function mysqlContainerQuery(runCommand, containerId, database, sql) {
  const result = await runCommand('docker', [
    'exec', containerId, 'mysql',
    `--defaults-extra-file=${TARGET_CNF_PATH}`,
    `--database=${database}`,
    '--batch', '--raw', '--skip-column-names',
    '--execute', sql
  ]);
  return result.stdout.trim();
}

function parseJsonRows(output, label) {
  try {
    const value = JSON.parse(output || '[]');
    if (!Array.isArray(value)) throw new Error('not array');
    return value;
  } catch (error) {
    fail('DB_RESTORE_METADATA_INVALID', `${label} 元数据不是有效 JSON 数组`, EXIT_CODES.VERIFICATION, error);
  }
}

async function captureSnapshot(query) {
  const snapshot = {};
  for (const [name, spec] of Object.entries(METADATA_SPECS)) {
    snapshot[name] = parseJsonRows(await query(buildMetadataQuery(spec)), name);
  }
  const tables = snapshot.objects
    .filter((row) => row.table_type === 'BASE TABLE')
    .map((row) => row.table_name)
    .sort();
  snapshot.rowCounts = [];
  for (const tableName of tables) {
    const output = await query(`SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`);
    if (!/^\d+$/.test(output)) {
      fail('DB_RESTORE_ROW_COUNT_INVALID', '全表行数查询返回无效结果', EXIT_CODES.VERIFICATION);
    }
    snapshot.rowCounts.push({ table_name: tableName, row_count: output });
  }
  return snapshot;
}

async function captureRowCounts(query, objects) {
  const rows = [];
  for (const object of objects.filter((row) => row.table_type === 'BASE TABLE')) {
    const output = await query(`SELECT COUNT(*) FROM ${quoteIdentifier(object.table_name)}`);
    rows.push({ table_name: object.table_name, row_count: output });
  }
  return rows;
}

async function verifyGzipAndHash(dumpPath) {
  const hash = crypto.createHash('sha256');
  let compressedBytes = 0;
  let plainBytes = 0;
  const compressedCounter = new stream.Transform({
    transform(chunk, encoding, callback) {
      compressedBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const sink = new stream.Writable({
    write(chunk, encoding, callback) {
      plainBytes += chunk.length;
      callback();
    }
  });
  try {
    await pipeline(fs.createReadStream(dumpPath), compressedCounter, zlib.createGunzip(), sink);
  } catch (error) {
    fail('DB_RESTORE_GZIP_INVALID', '备份 gzip 完整性校验失败', EXIT_CODES.DUMP, error);
  }
  if (compressedBytes === 0 || plainBytes === 0) {
    fail('DB_RESTORE_GZIP_EMPTY', '备份 gzip 或解压内容为空', EXIT_CODES.DUMP);
  }
  return { sha256: hash.digest('hex'), compressedBytes, plainBytes };
}

async function restoreGzip({
  dumpPath,
  expectedSha256,
  containerId,
  targetDatabase,
  spawn = childProcess.spawn,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
}) {
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))) {
    fail('DB_RESTORE_EXPECTED_SHA256_INVALID', '恢复工件预期 SHA256 不合法', EXIT_CODES.CONFIG);
  }
  const child = spawn('docker', [
    'exec', '-i', containerId, 'mysql',
    `--defaults-extra-file=${TARGET_CNF_PATH}`,
    '--default-character-set=utf8mb4',
    targetDatabase
  ], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.resume();
  child.stderr.resume();
  const childResult = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(Object.assign(new Error('restore timed out'), { code: 'COMMAND_TIMEOUT' }));
    }, timeoutMs);
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(Object.assign(new Error(`docker exec mysql exited ${code}`), { exitCode: code }));
    });
  });
  const restoreHash = crypto.createHash('sha256');
  let restoredCompressedBytes = 0;
  const compressedVerifier = new stream.Transform({
    transform(chunk, encoding, callback) {
      restoredCompressedBytes += chunk.length;
      restoreHash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    const streamResult = pipeline(
      fs.createReadStream(dumpPath),
      compressedVerifier,
      zlib.createGunzip(),
      new SqlSafetyTransform(),
      child.stdin
    ).catch((error) => {
      if (!child.killed) child.kill('SIGKILL');
      throw error;
    });
    await Promise.all([
      streamResult,
      childResult
    ]);
  } catch (error) {
    if (!child.killed) child.kill('SIGKILL');
    if (error instanceof DbRestoreSmokeError) throw error;
    fail('DB_RESTORE_IMPORT_FAILED', '恢复 gzip 到临时 MySQL 失败', EXIT_CODES.RESTORE, error);
  }
  const restoredSha256 = restoreHash.digest('hex');
  if (restoredSha256 !== expectedSha256) {
    fail('DB_RESTORE_STREAM_SHA256_MISMATCH', '恢复时读取的工件 SHA256 与 receipt 不一致', EXIT_CODES.RESTORE);
  }
  return { sha256: restoredSha256, compressedBytes: restoredCompressedBytes };
}

function validateContainerId(value) {
  const containerId = String(value || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(containerId)) {
    fail('DB_RESTORE_CONTAINER_ID_INVALID', 'docker run 未返回完整容器 ID', EXIT_CODES.RESTORE);
  }
  return containerId;
}

async function waitForTarget(runCommand, containerId, options = {}) {
  const attempts = options.attempts || 60;
  const delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await runCommand('docker', [
        'exec', containerId, 'mysqladmin',
        `--defaults-extra-file=${TARGET_CNF_PATH}`, 'ping', '--silent'
      ]);
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        fail('DB_RESTORE_TARGET_NOT_READY', '临时 MySQL 未在限定时间内就绪', EXIT_CODES.RESTORE, error);
      }
      await delay(1000);
    }
  }
}

function assertSafeTempDir(tempDir, tmpRoot = os.tmpdir()) {
  const resolved = path.resolve(tempDir);
  const resolvedRoot = path.resolve(tmpRoot);
  if (path.dirname(resolved) !== resolvedRoot || !path.basename(resolved).startsWith(TEMP_PREFIX)) {
    fail('DB_RESTORE_TEMP_PATH_INVALID', '拒绝清理非本次 smoke 临时目录', EXIT_CODES.CLEANUP);
  }
  return resolved;
}

async function cleanupExactResources({
  containerId,
  tempDir,
  tmpRoot = os.tmpdir(),
  runCommand = defaultRunCommand,
  fsApi = fsPromises
}) {
  let cleanupError;
  if (containerId) {
    try {
      await runCommand('docker', ['rm', '-f', validateContainerId(containerId)]);
    } catch (error) {
      cleanupError = new DbRestoreSmokeError(
        'DB_RESTORE_CONTAINER_CLEANUP_FAILED',
        '无法按保存的容器 ID 精确清理临时 MySQL',
        EXIT_CODES.CLEANUP,
        error
      );
    }
  }
  if (tempDir) {
    try {
      await fsApi.rm(assertSafeTempDir(tempDir, tmpRoot), { recursive: true, force: true });
    } catch (error) {
      cleanupError = cleanupError || new DbRestoreSmokeError(
        'DB_RESTORE_TEMP_CLEANUP_FAILED',
        '无法精确清理本次 smoke 临时目录',
        EXIT_CODES.CLEANUP,
        error
      );
    }
  }
  if (cleanupError) throw cleanupError;
}

function redactSensitiveText(value, env = process.env) {
  let result = String(value || '');
  for (const name of [
    'DB_BACKUP_PASSWORD',
    'DB_BACKUP_USER',
    'DB_BACKUP_HOST',
    'DB_BACKUP_NAME',
    'COS_BACKUP_RESTORE_SECRET_ID',
    'COS_BACKUP_RESTORE_SECRET_KEY',
    'COS_BACKUP_RESTORE_SECURITY_TOKEN',
    'DB_RESTORE_RECEIPT_PATH',
    'BACKUP_DIR'
  ]) {
    const sensitive = env[name];
    if (typeof sensitive === 'string' && sensitive.length >= 2) {
      result = result.split(sensitive).join('[REDACTED]');
    }
  }
  return result.replace(/(?:password|passwd|pwd)\s*[=:]\s*[^\s,;]+/gi, 'password=[REDACTED]');
}

async function runDbRestoreSmoke(options = {}) {
  const env = options.env || process.env;
  const output = options.output || console;
  const spawn = options.spawn || childProcess.spawn;
  const fsApi = options.fsPromises || fsPromises;
  const tmpRoot = options.tmpRoot || os.tmpdir();
  const config = loadConfig(env);
  const runCommand = options.runCommand || (
    (file, args, commandOptions = {}) => defaultRunCommand(file, args, {
      timeoutMs: config.commandTimeoutMs,
      ...commandOptions
    })
  );
  const context = createRunContext(options.randomBytes || crypto.randomBytes);
  const receiptBundle = await loadAndValidateReceipt(config, { fsPromises: fsApi });
  let tempDir;
  let containerId;
  let primaryError;
  let result;

  try {
    tempDir = await fsApi.mkdtemp(path.join(tmpRoot, TEMP_PREFIX));
    await fsApi.chmod(tempDir, 0o700);
    const sourceCnf = path.join(tempDir, 'source.cnf');
    const targetCnf = path.join(tempDir, 'target.cnf');
    const envFile = path.join(tempDir, 'container.env');
    await writePrivateFile(sourceCnf, sourceCnfContents(config.source), { fsPromises: fsApi });
    await writePrivateFile(targetCnf, targetCnfContents(context), { fsPromises: fsApi });
    await writePrivateFile(envFile, [
      `MYSQL_ROOT_PASSWORD=${context.rootPassword}`,
      `MYSQL_DATABASE=${context.targetDatabase}`,
      ''
    ].join('\n'), { fsPromises: fsApi });

    let artifactPath = receiptBundle.artifactPath;
    if (config.artifactSource === 'cos') {
      const cosClient = options.cosClient || createCosRestoreClient(
        config.cosRestore,
        options.COSClass
      );
      const downloaded = await downloadCosReceiptArtifact({
        config,
        receipt: receiptBundle.receipt,
        destinationPath: path.join(tempDir, 'cos-artifact.sql.gz'),
        client: cosClient,
        tempDir,
        tmpRoot,
        fsApi,
        platform: options.platform || process.platform
      });
      artifactPath = downloaded.artifactPath;
    }

    const hostQuery = (sql) => mysqlHostQuery(
      runCommand,
      sourceCnf,
      config.source.database,
      sql
    );
    const sourceUuid = await hostQuery('SELECT @@server_uuid');
    assertReceiptSourceServerUuid(receiptBundle.receipt.sourceServerUuid, sourceUuid);
    const grantsOutput = await hostQuery('SHOW GRANTS FOR CURRENT_USER()');
    validateReadOnlyGrants(
      grantsOutput.split(/\r?\n/).filter(Boolean),
      config.source.database
    );
    const sourceSnapshot = await captureSnapshot(hostQuery);
    assertInnoDbTables(sourceSnapshot);

    const dockerRun = await runCommand('docker', buildDockerRunArgs(config, context, envFile));
    containerId = validateContainerId(dockerRun.stdout);
    await runCommand('docker', ['cp', targetCnf, `${containerId}:${TARGET_CNF_PATH}`]);
    await runCommand('docker', ['exec', containerId, 'chmod', '600', TARGET_CNF_PATH]);
    await waitForTarget(runCommand, containerId, { delay: options.delay, attempts: options.readyAttempts });

    const containerQuery = (sql) => mysqlContainerQuery(
      runCommand,
      containerId,
      context.targetDatabase,
      sql
    );
    const targetUuid = await containerQuery('SELECT @@server_uuid');
    assertDifferentServerUuids(sourceUuid, targetUuid);
    const restoredArtifact = await restoreGzip({
      dumpPath: artifactPath,
      expectedSha256: receiptBundle.receipt.artifact.sha256,
      containerId,
      targetDatabase: context.targetDatabase,
      spawn,
      timeoutMs: config.commandTimeoutMs
    });

    const targetSnapshot = await captureSnapshot(containerQuery);
    assertInnoDbTables(targetSnapshot);
    compareSnapshots(sourceSnapshot, targetSnapshot);
    assertCriticalStructures(targetSnapshot);
    const sourceRowsAfter = await captureRowCounts(hostQuery, sourceSnapshot.objects);
    assertSourceRowsUnchanged(sourceSnapshot.rowCounts, sourceRowsAfter);

    result = Object.freeze({
      ok: true,
      imageVersion: config.mysqlVersion,
      tableCount: sourceSnapshot.rowCounts.length,
      objectCount: sourceSnapshot.objects.length,
      backupId: receiptBundle.receipt.backupId,
      artifactSha256: restoredArtifact.sha256,
      compressedBytes: restoredArtifact.compressedBytes,
      receiptSchemaVersion: receiptBundle.receipt.schemaVersion,
      artifactSource: config.artifactSource
    });
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupExactResources({ containerId, tempDir, tmpRoot, runCommand, fsApi });
    } catch (cleanupError) {
      if (primaryError) cleanupError.primaryCode = primaryError.code;
      primaryError = cleanupError;
    }
  }
  if (primaryError) throw primaryError;
  output.log(JSON.stringify(result));
  return result;
}

async function main({ env = process.env, output = console, runner = runDbRestoreSmoke } = {}) {
  try {
    await runner({ env, output });
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const allowed = Object.values(EXIT_CODES);
    const exitCode = allowed.includes(error?.exitCode) ? error.exitCode : EXIT_CODES.UNEXPECTED;
    const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'DB_RESTORE_UNEXPECTED_ERROR';
    const message = error?.isOperational ? error.message : '数据库恢复 smoke 执行异常';
    output.error(JSON.stringify({ ok: false, code, message: redactSensitiveText(message, env) }));
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
  TEMP_PREFIX,
  TARGET_DATABASE_PREFIX,
  CONTAINER_PREFIX,
  CONTAINER_LABEL,
  TARGET_CNF_PATH,
  RECEIPT_SCHEMA_VERSION,
  DUMP_PROFILE_VERSION,
  RECEIPT_SUFFIX,
  EXIT_CODES,
  READ_ONLY_PRIVILEGES,
  CRITICAL_UNIQUE_INDEXES,
  METADATA_SPECS,
  DbRestoreSmokeError,
  loadConfig,
  findForbiddenTargetVariables,
  createRunContext,
  buildDockerRunArgs,
  sourceCnfContents,
  targetCnfContents,
  writePrivateFile,
  assertPrivateRegularFile,
  validateReceiptShape,
  loadAndValidateReceipt,
  assertReceiptSourceServerUuid,
  createCosRestoreClient,
  downloadCosReceiptArtifact,
  parseGrant,
  tokenizeGrantPrivileges,
  validateReadOnlyGrants,
  assertDifferentServerUuids,
  SqlSafetyTransform,
  assertSqlSafe,
  buildMetadataQuery,
  stableRows,
  compareSnapshots,
  assertSourceRowsUnchanged,
  assertCriticalStructures,
  assertInnoDbTables,
  defaultRunCommand,
  captureSnapshot,
  captureRowCounts,
  verifyGzipAndHash,
  restoreGzip,
  validateContainerId,
  waitForTarget,
  assertSafeTempDir,
  cleanupExactResources,
  redactSensitiveText,
  runDbRestoreSmoke,
  main
};
