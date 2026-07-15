'use strict';

const fs = require('fs');
const path = require('path');

const BACKUP_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'backup-to-cos.sh');
const UPLOAD_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'upload-backup-to-cos.js');
const RESTORE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'run-db-restore-smoke.js');

describe('数据库备份脚本静态安全门禁', () => {
  const source = fs.readFileSync(BACKUP_SCRIPT, 'utf8');
  const uploadSource = fs.readFileSync(UPLOAD_SCRIPT, 'utf8');
  const restoreSource = fs.readFileSync(RESTORE_SCRIPT, 'utf8');

  test('严格 shell 模式阻止 mysqldump 管道前段失败被 gzip 成功掩盖', () => {
    expect(source).toMatch(/^set -euo pipefail$/m);
    expect(source).toMatch(/^umask 077$/m);
    expect(source).toMatch(
      /mysqldump[\s\S]*?\| gzip > "\$PART_FILE"/
    );
  });

  test('上传前必须同时验证备份非空和 gzip 完整性', () => {
    const nonEmptyCheck = 'test -s "$PART_FILE"';
    const gzipCheck = 'gzip -t "$PART_FILE"';
    const uploadMarker = 'echo "2. 上传到 COS并回读元数据..."';

    expect(source).toContain(nonEmptyCheck);
    expect(source).toContain(gzipCheck);
    expect(source.indexOf(nonEmptyCheck)).toBeLessThan(source.indexOf(uploadMarker));
    expect(source.indexOf(gzipCheck)).toBeLessThan(source.indexOf(uploadMarker));
  });

  test('数据库密码只进入 0600 临时配置且退出时精确清理', () => {
    expect(source).toContain('MYSQL_CNF=$(mktemp "${BACKUP_DIR}/mysql-client.XXXXXX.cnf")');
    expect(source).toContain('rm -f "$MYSQL_CNF" "${PART_FILE:-}"');
    expect(source).toContain('trap cleanup EXIT');
    expect(source).toContain('chmod 600 "$MYSQL_CNF"');
    expect(source).toContain('--defaults-extra-file="$MYSQL_CNF"');
    expect(source).not.toMatch(/mysqldump[^\n]*(?:-p|--password)/);
  });

  test('本地过期清理仅匹配固定备份文件模式和受控目录', () => {
    expect(source).toContain('find "$BACKUP_DIR" -type f');
    expect(source).toContain('-name "erp_db_*.sql.gz"');
    expect(source).toContain('"${EXPIRED_BACKUP}.sha256"');
    expect(source).toContain('"${EXPIRED_BACKUP}.receipt.json"');
    expect(source).toContain('-mtime "+${KEEP_DAYS}" -print0');
    expect(source).toContain('rm -f -- "$EXPIRED_BACKUP"');
    expect(source).not.toMatch(/find\s+\/\s/);
    expect(source).not.toMatch(/rm\s+-rf/);
  });

  test('强制使用独立备份账号且拒绝复用应用 DB_USER', () => {
    expect(source).toContain('${DB_BACKUP_USER:?缺少独立只读备份账号 DB_BACKUP_USER}');
    expect(source).toContain('${DB_BACKUP_PASSWORD:?缺少独立只读备份密码 DB_BACKUP_PASSWORD}');
    expect(source).toContain('[ "$DB_BACKUP_USER" = "$DB_USER" ]');
    expect(source).toContain('DB_BACKUP_USER 不得复用应用 DB_USER');
    expect(source).not.toContain('${DB_PASSWORD:?');
  });

  test('强制使用独立 COS 备份凭证和桶且拒绝复用业务桶', () => {
    expect(source).toContain('${COS_BACKUP_SECRET_ID:?缺少独立备份凭证 COS_BACKUP_SECRET_ID}');
    expect(source).toContain('${COS_BACKUP_SECRET_KEY:?缺少独立备份凭证 COS_BACKUP_SECRET_KEY}');
    expect(source).toContain('${COS_BACKUP_BUCKET:?缺少独立备份桶 COS_BACKUP_BUCKET}');
    expect(source).toContain('COS_BACKUP_BUCKET 不得复用 ERP 业务 COS_BUCKET');
    expect(source).toContain('SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)');
    expect(source).toContain('node "$SCRIPT_DIR/upload-backup-to-cos.js"');
    expect(uploadSource).toContain("required(env, 'COS_BACKUP_SECRET_ID')");
    expect(uploadSource).toContain("required(env, 'COS_BACKUP_SECRET_KEY')");
    expect(uploadSource).not.toContain("required(env, 'COS_SECRET_ID')");
    expect(uploadSource).not.toContain("required(env, 'COS_SECRET_KEY')");
  });

  test('使用原子临时文件、SHA256 sidecar 和并发锁', () => {
    expect(source).toContain('flock -n 9');
    expect(source).toContain('BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_DIR}/.backup.lock}"');
    expect(source).toContain('[ ! -L "$BACKUP_DIR" ]');
    expect(source).toContain('chmod 700 "$BACKUP_DIR"');
    expect(source).toContain('[ ! -L "$BACKUP_LOCK_FILE" ]');
    expect(source).toContain('PART_FILE="${BACKUP_FILE}.part"');
    expect(source).toContain('sha256sum "$PART_FILE"');
    expect(source).toContain('mv -f "$PART_FILE" "$BACKUP_FILE"');
    expect(source).toContain('SHA_FILE="${BACKUP_FILE}.sha256"');
  });

  test('dump 参数覆盖事务一致性、二进制、事件和生产兼容边界', () => {
    for (const option of [
      '--single-transaction',
      '--skip-lock-tables',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--no-tablespaces',
      '--set-gtid-purged=OFF',
      '--no-create-db',
      '--default-character-set=utf8mb4'
    ]) {
      expect(source).toContain(option);
    }
  });

  test('COS put 后必须 HEAD 校验内容长度和 SHA256 元数据', () => {
    expect(uploadSource).toContain("Headers: { 'x-cos-meta-sha256': config.sha256 }");
    expect(uploadSource).toContain("head = await invoke(client, 'headObject', params);");
    expect(uploadSource).toContain("headers['content-length']");
    expect(uploadSource).toContain("headers['x-cos-meta-sha256']");
    expect(uploadSource).toContain('COS_BACKUP_HEAD_SIZE_MISMATCH');
    expect(uploadSource).toContain('COS_BACKUP_HEAD_SHA256_MISMATCH');
  });

  test('HEAD 成功后原子写入 0600 receipt，backupId 来自 Node CSPRNG', () => {
    expect(source).toContain('RECEIPT_FILE="${BACKUP_FILE}.receipt.json"');
    expect(source).toContain('BACKUP_RECEIPT_PATH="$RECEIPT_FILE"');
    expect(source).toContain('BACKUP_SOURCE_SERVER_UUID="$SOURCE_SERVER_UUID"');
    expect(source).not.toContain('BACKUP_ID=');
    expect(uploadSource).toContain('crypto.randomUUID');
    expect(uploadSource).toContain("fileSystem.openSync(partPath, 'wx', 0o600)");
    expect(uploadSource).toContain('fileSystem.fsyncSync(descriptor)');
    expect(uploadSource).toContain('fileSystem.renameSync(partPath, receiptPath)');
    expect(uploadSource).toContain('fileSystem.chmodSync(receiptPath, 0o600)');
  });

  test('backup env、uploader receipt 与 restore receipt 使用同一固定契约', () => {
    for (const field of [
      'BACKUP_RECEIPT_PATH',
      'BACKUP_CREATED_AT',
      'BACKUP_DATABASE_NAME',
      'BACKUP_SOURCE_SERVER_UUID',
      'BACKUP_DUMP_PROFILE_VERSION'
    ]) {
      expect(source).toContain(`${field}=`);
    }
    expect(source).toContain('DUMP_PROFILE_VERSION="erp-db-full-v1"');
    expect(uploadSource).toContain("const DUMP_PROFILE_VERSION = 'erp-db-full-v1'");
    expect(restoreSource).toContain("const DUMP_PROFILE_VERSION = 'erp-db-full-v1'");
    expect(uploadSource).toContain('schemaVersion: RECEIPT_SCHEMA_VERSION');
    expect(uploadSource).toContain('uploaderCredentialIdSha256');
    expect(restoreSource).toContain('receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION');
    expect(uploadSource).toContain('return `erp-${uuid.toLowerCase()}`');
    expect(restoreSource).toContain("/^erp-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/");
  });
});
