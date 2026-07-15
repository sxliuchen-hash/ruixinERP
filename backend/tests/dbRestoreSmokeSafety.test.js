'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const stream = require('stream');
const { EventEmitter } = require('events');
const {
  buildReceipt,
  DUMP_PROFILE_VERSION: UPLOAD_DUMP_PROFILE_VERSION
} = require('../scripts/upload-backup-to-cos');
const {
  EXIT_CODES,
  DbRestoreSmokeError,
  loadConfig,
  DUMP_PROFILE_VERSION,
  createRunContext,
  buildDockerRunArgs,
  sourceCnfContents,
  assertPrivateRegularFile,
  loadAndValidateReceipt,
  assertReceiptSourceServerUuid,
  createCosRestoreClient,
  downloadCosReceiptArtifact,
  restoreGzip,
  validateReadOnlyGrants,
  assertDifferentServerUuids,
  assertSqlSafe,
  buildMetadataQuery,
  compareSnapshots,
  assertSourceRowsUnchanged,
  assertCriticalStructures,
  assertInnoDbTables,
  validateContainerId,
  cleanupExactResources,
  redactSensitiveText,
  main
} = require('../scripts/run-db-restore-smoke');

const PINNED_IMAGE = `mysql:9.1.0@sha256:${'a'.repeat(64)}`;

function validEnv(overrides = {}) {
  return {
    ALLOW_DB_RESTORE_SMOKE: 'YES',
    DB_BACKUP_HOST: 'backup-source.internal',
    DB_BACKUP_PORT: '3306',
    DB_BACKUP_NAME: 'erp',
    DB_BACKUP_USER: 'erp_backup_reader',
    DB_BACKUP_PASSWORD: 'very-secret-password',
    DB_RESTORE_MYSQL_IMAGE: PINNED_IMAGE,
    DB_RESTORE_COMMAND_TIMEOUT_MS: '300000',
    DB_USER: 'erp_application',
    BACKUP_DIR: path.join(os.tmpdir(), 'erp-backups'),
    DB_RESTORE_RECEIPT_PATH: path.join(
      os.tmpdir(),
      'erp-backups',
      'erp_db_20260711_120000.sql.gz.receipt.json'
    ),
    ...overrides
  };
}

function validSnapshot() {
  return {
    objects: [
      { table_name: 'contracts', table_type: 'BASE TABLE', engine: 'InnoDB' },
      { table_name: 'employees', table_type: 'BASE TABLE', engine: 'InnoDB' },
      { table_name: 'expenses', table_type: 'BASE TABLE', engine: 'InnoDB' },
      { table_name: 'payments', table_type: 'BASE TABLE', engine: 'InnoDB' },
      { table_name: 'performance_imports', table_type: 'BASE TABLE', engine: 'InnoDB' }
    ],
    rowCounts: [
      { table_name: 'contracts', row_count: '2' },
      { table_name: 'employees', row_count: '3' },
      { table_name: 'expenses', row_count: '4' },
      { table_name: 'payments', row_count: '5' },
      { table_name: 'performance_imports', row_count: '6' }
    ],
    columns: [
      {
        table_name: 'performance_imports',
        column_name: 'confirmed_period_key',
        extra: 'STORED GENERATED',
        generation_expression: "if((`status` = _utf8mb4'confirmed'),concat(`year`,_utf8mb4'-',lpad(`month`,2,_utf8mb4'0')),NULL)"
      },
      { table_name: 'payments', column_name: 'account_id', is_nullable: 'YES' }
    ],
    indexes: [
      { table_name: 'employees', index_name: 'uk_employees_user_id', non_unique: 0, seq_in_index: 1, column_name: 'user_id' },
      { table_name: 'contracts', index_name: 'uk_contracts_sp_no', non_unique: 0, seq_in_index: 1, column_name: 'sp_no' },
      { table_name: 'payments', index_name: 'uk_payments_sp_no', non_unique: 0, seq_in_index: 1, column_name: 'sp_no' },
      { table_name: 'expenses', index_name: 'uk_expenses_sp_no', non_unique: 0, seq_in_index: 1, column_name: 'sp_no' },
      { table_name: 'performance_imports', index_name: 'uk_performance_imports_confirmed_period', non_unique: 0, seq_in_index: 1, column_name: 'confirmed_period_key' }
    ],
    constraints: [],
    triggers: [],
    routines: [],
    events: []
  };
}

function createReceiptFixture(overrides = {}) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-restore-receipt-'));
  fs.chmodSync(backupDir, 0o700);
  const filename = 'erp_db_20260711_120000.sql.gz';
  const artifactPath = path.join(backupDir, filename);
  const artifactBytes = zlib.gzipSync(Buffer.from(
    'CREATE TABLE `receipt_fixture` (`id` INT PRIMARY KEY);\nINSERT INTO `receipt_fixture` VALUES (1);\n'
  ));
  fs.writeFileSync(artifactPath, artifactBytes, { mode: 0o600 });
  fs.chmodSync(artifactPath, 0o600);
  const sha256 = crypto.createHash('sha256').update(artifactBytes).digest('hex');
  const receiptPath = `${artifactPath}.receipt.json`;
  const receipt = buildReceipt({
    backupId: 'erp-123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-07-11T04:00:00Z',
    databaseName: 'erp',
    sourceServerUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    filePath: artifactPath,
    size: artifactBytes.length,
    sha256,
    bucket: 'erp-db-backup-1250000000',
    region: 'ap-guangzhou',
    objectKey: `erp-backups/db/${filename}`,
    secretId: 'upload-only-id',
    dumpProfileVersion: UPLOAD_DUMP_PROFILE_VERSION
  }, {
    headMetadata: {
      contentLength: String(artifactBytes.length),
      sha256,
      contentType: 'application/gzip'
    },
    etag: '"etag-value"',
    versionId: 'version-1'
  });
  Object.assign(receipt, {
    ...overrides
  });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  fs.chmodSync(receiptPath, 0o600);
  return {
    backupDir,
    artifactPath,
    artifactBytes,
    receiptPath,
    receipt,
    sha256,
    env: validEnv({ BACKUP_DIR: backupDir, DB_RESTORE_RECEIPT_PATH: receiptPath }),
    cleanup: () => fs.rmSync(backupDir, { recursive: true, force: true })
  };
}

describe('数据库备份恢复 smoke 安全门禁', () => {
  test('只有显式 YES 且全部源配置使用 DB_BACKUP_* 才接受', () => {
    expect(() => loadConfig(validEnv({ ALLOW_DB_RESTORE_SMOKE: 'yes' })))
      .toThrow(expect.objectContaining({
        code: 'DB_RESTORE_EXPLICIT_CONSENT_REQUIRED',
        exitCode: EXIT_CODES.CONFIG
      }));
    expect(() => loadConfig(validEnv({ DB_BACKUP_PASSWORD: '' })))
      .toThrow(expect.objectContaining({ code: 'DB_RESTORE_CONFIG_MISSING' }));
    expect(loadConfig(validEnv())).toMatchObject({
      source: { database: 'erp', user: 'erp_backup_reader', port: 3306 },
      image: PINNED_IMAGE,
      mysqlVersion: '9.1.0'
    });
  });

  test.each([
    { DB_TARGET_HOST: '127.0.0.1' },
    { TARGET_DB_PORT: '3306' },
    { DB_RESTORE_DATABASE: 'production' },
    { DB_RESTORE_TARGET_HOST: 'production.internal' },
    { DB_RESTORE_SMOKE_TARGET_NAME: 'anything' }
  ])('拒绝任何目标 host、port 或 database 环境变量 %#', (override) => {
    expect(() => loadConfig(validEnv(override))).toThrow(expect.objectContaining({
      code: 'DB_RESTORE_TARGET_ENV_FORBIDDEN',
      exitCode: EXIT_CODES.CONFIG
    }));
  });

  test('拒绝应用 DB_USER 和未按 digest 固定的镜像', () => {
    expect(() => loadConfig(validEnv({ DB_USER: 'ERP_BACKUP_READER' }))).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_APPLICATION_USER_FORBIDDEN' })
    );
    for (const image of ['mysql:9.1.0', `mariadb:11@sha256:${'a'.repeat(64)}`, 'mysql:latest@sha256:1234']) {
      expect(() => loadConfig(validEnv({ DB_RESTORE_MYSQL_IMAGE: image }))).toThrow(
        expect.objectContaining({ code: 'DB_RESTORE_IMAGE_NOT_PINNED' })
      );
    }
  });

  test('命令超时必须在安全范围内解析', () => {
    expect(loadConfig(validEnv()).commandTimeoutMs).toBe(300000);
    for (const value of ['999', '3600001', 'forever']) {
      expect(() => loadConfig(validEnv({ DB_RESTORE_COMMAND_TIMEOUT_MS: value }))).toThrow(
        expect.objectContaining({ code: 'DB_RESTORE_TIMEOUT_INVALID' })
      );
    }
  });

  test.each([
    ['latest', (root) => path.join(root, 'latest')],
    ['list', (root) => path.join(root, 'list')],
    ['通配', (root) => path.join(root, '*.receipt.json')],
    ['上级目录', (root) => `${root}${path.sep}..${path.sep}erp_db_20260711_120000.sql.gz.receipt.json`]
  ])('拒绝 receipt %s 选择器', (_label, makePath) => {
    const root = path.join(os.tmpdir(), 'erp-backups');
    expect(() => loadConfig(validEnv({
      BACKUP_DIR: root,
      DB_RESTORE_RECEIPT_PATH: makePath(root)
    }))).toThrow(expect.objectContaining({
      code: 'DB_RESTORE_RECEIPT_SELECTOR_FORBIDDEN'
    }));
  });

  test('拒绝 BACKUP_DIR 范围外或非固定命名的 receipt', () => {
    expect(() => loadConfig(validEnv({
      DB_RESTORE_RECEIPT_PATH: path.join(
        os.tmpdir(), 'outside', 'erp_db_20260711_120000.sql.gz.receipt.json'
      )
    }))).toThrow(expect.objectContaining({ code: 'DB_RESTORE_RECEIPT_SCOPE_INVALID' }));
  });

  test('精确 receipt、artifact 大小、gzip 和 SHA256 全部一致时通过', async () => {
    const fixture = createReceiptFixture();
    try {
      const config = loadConfig(fixture.env);
      expect(UPLOAD_DUMP_PROFILE_VERSION).toBe(DUMP_PROFILE_VERSION);
      const result = await loadAndValidateReceipt(config);
      expect(result.receipt.backupId).toBe('erp-123e4567-e89b-42d3-a456-426614174000');
      expect(result.artifactPath).toBe(fixture.artifactPath);
      expect(result.verifiedArtifact).toMatchObject({
        sha256: fixture.sha256,
        compressedBytes: fs.statSync(fixture.artifactPath).size
      });
    } finally {
      fixture.cleanup();
    }
  });

  test('COS 模式强制独立只读凭证且本地模式不要求 COS 凭证', () => {
    expect(loadConfig(validEnv()).artifactSource).toBe('local');
    expect(() => loadConfig(validEnv({
      DB_RESTORE_ARTIFACT_SOURCE: 'cos'
    }))).toThrow(expect.objectContaining({ code: 'DB_RESTORE_CONFIG_MISSING' }));
    expect(() => loadConfig(validEnv({
      DB_RESTORE_ARTIFACT_SOURCE: 'cos',
      COS_BACKUP_RESTORE_SECRET_ID: 'same-id',
      COS_BACKUP_RESTORE_SECRET_KEY: 'restore-key',
      COS_BACKUP_SECRET_ID: 'same-id',
      COS_BACKUP_SECRET_KEY: 'upload-key'
    }))).toThrow(expect.objectContaining({ code: 'DB_RESTORE_COS_CREDENTIAL_REUSED' }));
    expect(() => loadConfig(validEnv({
      DB_RESTORE_ARTIFACT_SOURCE: 'cos',
      COS_BACKUP_RESTORE_SECRET_ID: 'restore-id',
      COS_BACKUP_RESTORE_SECRET_KEY: 'same-key',
      COS_BACKUP_SECRET_ID: 'upload-id',
      COS_BACKUP_SECRET_KEY: 'same-key'
    }))).toThrow(expect.objectContaining({ code: 'DB_RESTORE_COS_CREDENTIAL_REUSED' }));
  });

  test('COS 恢复客户端只使用独立只读凭证', () => {
    const COSClass = jest.fn(() => ({ getObject: jest.fn() }));
    const config = loadConfig(validEnv({
      DB_RESTORE_ARTIFACT_SOURCE: 'cos',
      COS_BACKUP_RESTORE_SECRET_ID: 'restore-only-id',
      COS_BACKUP_RESTORE_SECRET_KEY: 'restore-only-key',
      COS_BACKUP_RESTORE_SECURITY_TOKEN: 'restore-only-token'
    }));
    createCosRestoreClient(config.cosRestore, COSClass);
    expect(COSClass).toHaveBeenCalledWith({
      SecretId: 'restore-only-id',
      SecretKey: 'restore-only-key',
      SecurityToken: 'restore-only-token'
    });
  });

  test('即使环境未保留上传凭证，也通过 receipt 指纹拒绝复用上传 SecretId', async () => {
    const fixture = createReceiptFixture();
    try {
      const config = loadConfig({
        ...fixture.env,
        DB_RESTORE_ARTIFACT_SOURCE: 'cos',
        COS_BACKUP_RESTORE_SECRET_ID: 'upload-only-id',
        COS_BACKUP_RESTORE_SECRET_KEY: 'unknown-key'
      });
      await expect(loadAndValidateReceipt(config)).rejects.toMatchObject({
        code: 'DB_RESTORE_COS_CREDENTIAL_REUSED'
      });
    } finally {
      fixture.cleanup();
    }
  });

  test('COS 模式不要求本地 artifact，只按 receipt exact key/version 流式下载并校验', async () => {
    const fixture = createReceiptFixture();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-db-restore-smoke-'));
    fs.chmodSync(tempDir, 0o700);
    const destinationPath = path.join(tempDir, 'cos-artifact.sql.gz');
    const listObjects = jest.fn();
    const listObjectVersions = jest.fn();
    const getObject = jest.fn((params, callback) => {
      expect(params).toMatchObject({
        Bucket: fixture.receipt.cos.bucket,
        Region: fixture.receipt.cos.region,
        Key: fixture.receipt.cos.objectKey,
        VersionId: fixture.receipt.cos.versionId,
        IfMatch: fixture.receipt.cos.etag
      });
      expect(params.Output).toBeInstanceOf(stream.Writable);
      params.Output.end(fixture.artifactBytes, () => callback(null, {
        VersionId: fixture.receipt.cos.versionId,
        ETag: fixture.receipt.cos.etag
      }));
    });
    try {
      fs.rmSync(fixture.artifactPath);
      const config = loadConfig({
        ...fixture.env,
        DB_RESTORE_ARTIFACT_SOURCE: 'cos',
        COS_BACKUP_RESTORE_SECRET_ID: 'restore-id',
        COS_BACKUP_RESTORE_SECRET_KEY: 'restore-key'
      });
      const receiptBundle = await loadAndValidateReceipt(config);
      expect(receiptBundle.artifactPath).toBeNull();
      const result = await downloadCosReceiptArtifact({
        config,
        receipt: receiptBundle.receipt,
        destinationPath,
        client: { getObject, listObjects, listObjectVersions },
        tempDir
      });
      expect(result.verifiedArtifact).toMatchObject({
        sha256: fixture.sha256,
        compressedBytes: fixture.artifactBytes.length
      });
      expect(fs.readFileSync(destinationPath)).toEqual(fixture.artifactBytes);
      expect(getObject).toHaveBeenCalledTimes(1);
      expect(listObjects).not.toHaveBeenCalled();
      expect(listObjectVersions).not.toHaveBeenCalled();
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'run-db-restore-smoke.js'),
        'utf8'
      );
      expect(source).not.toMatch(/client\.(?:listObjects|listObjectVersions|getBucket)\s*\(/);
    } finally {
      fixture.cleanup();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.each([
    ['下载失败', 'download', 'DB_RESTORE_COS_DOWNLOAD_FAILED'],
    ['版本不符', 'version', 'DB_RESTORE_COS_VERSION_MISMATCH'],
    ['大小不符', 'size', 'DB_RESTORE_COS_SIZE_MISMATCH'],
    ['SHA 不符', 'sha', 'DB_RESTORE_COS_SHA256_MISMATCH']
  ])('COS %s时 fail-closed 并清理部分下载', async (_label, mode, expectedCode) => {
    const fixture = createReceiptFixture();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-db-restore-smoke-'));
    fs.chmodSync(tempDir, 0o700);
    const destinationPath = path.join(tempDir, 'cos-artifact.sql.gz');
    const config = loadConfig({
      ...fixture.env,
      DB_RESTORE_ARTIFACT_SOURCE: 'cos',
      COS_BACKUP_RESTORE_SECRET_ID: 'restore-id',
      COS_BACKUP_RESTORE_SECRET_KEY: 'restore-key'
    });
    const receipt = JSON.parse(JSON.stringify(fixture.receipt));
    if (mode === 'sha') {
      receipt.artifact.sha256 = 'b'.repeat(64);
      receipt.cos.headMetadata.sha256 = 'b'.repeat(64);
    }
    const client = {
      getObject: jest.fn((params, callback) => {
        if (mode === 'download') {
          params.Output.write(Buffer.from('partial'));
          callback(new Error('secret remote failure'));
          return;
        }
        const body = mode === 'size'
          ? Buffer.concat([fixture.artifactBytes, Buffer.from('extra')])
          : fixture.artifactBytes;
        params.Output.end(body, () => callback(null, {
          VersionId: mode === 'version' ? 'unexpected-version' : receipt.cos.versionId
        }));
      })
    };
    try {
      await expect(downloadCosReceiptArtifact({
        config,
        receipt,
        destinationPath,
        client,
        tempDir
      })).rejects.toMatchObject({ code: expectedCode });
      expect(fs.existsSync(destinationPath)).toBe(false);
    } finally {
      fixture.cleanup();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('receipt 或 artifact 篡改、权限放宽均 fail-closed', async () => {
    const receiptTamper = createReceiptFixture();
    try {
      receiptTamper.receipt.artifact.sha256 = 'b'.repeat(64);
      receiptTamper.receipt.cos.headMetadata.sha256 = 'b'.repeat(64);
      fs.writeFileSync(receiptTamper.receiptPath, JSON.stringify(receiptTamper.receipt), { mode: 0o600 });
      await expect(loadAndValidateReceipt(loadConfig(receiptTamper.env))).rejects.toMatchObject({
        code: 'DB_RESTORE_ARTIFACT_SHA256_MISMATCH'
      });
    } finally {
      receiptTamper.cleanup();
    }

    const artifactTamper = createReceiptFixture();
    try {
      fs.appendFileSync(artifactTamper.artifactPath, Buffer.from('tampered'));
      await expect(loadAndValidateReceipt(loadConfig(artifactTamper.env))).rejects.toMatchObject({
        code: 'DB_RESTORE_ARTIFACT_SIZE_MISMATCH'
      });
    } finally {
      artifactTamper.cleanup();
    }

    const weakMode = createReceiptFixture();
    try {
      if (process.platform !== 'win32') {
        fs.chmodSync(weakMode.receiptPath, 0o644);
        await expect(loadAndValidateReceipt(loadConfig(weakMode.env))).rejects.toMatchObject({
          code: 'DB_RESTORE_FILE_MODE_INVALID'
        });
      } else {
        const weakStats = {
          isFile: () => true,
          isSymbolicLink: () => false,
          mode: 0o100644
        };
        await expect(assertPrivateRegularFile('/safe/receipt', 'receipt', {
          lstat: jest.fn().mockResolvedValue(weakStats)
        }, 'linux')).rejects.toMatchObject({ code: 'DB_RESTORE_FILE_MODE_INVALID' });
      }
    } finally {
      weakMode.cleanup();
    }
  });

  test('receipt 和 artifact 均拒绝符号链接', async () => {
    const symbolicStats = {
      isFile: () => true,
      isSymbolicLink: () => true,
      mode: 0o100600
    };
    await expect(assertPrivateRegularFile('/safe/link', 'receipt', {
      lstat: jest.fn().mockResolvedValue(symbolicStats)
    })).rejects.toMatchObject({ code: 'DB_RESTORE_SYMLINK_FORBIDDEN' });
  });

  test('当前源库 UUID 必须与生成工件时 receipt UUID 一致', () => {
    expect(assertReceiptSourceServerUuid('UUID-AAAA', 'uuid-aaaa')).toBe(true);
    expect(() => assertReceiptSourceServerUuid('uuid-aaaa', 'uuid-bbbb')).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_SOURCE_UUID_RECEIPT_MISMATCH' })
    );
  });

  test('实际恢复读取的同一压缩字节流再次计算 receipt SHA256', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-restore-stream-'));
    const artifactPath = path.join(tempDir, 'artifact.sql.gz');
    const sql = Buffer.from('CREATE TABLE `same_bytes` (`id` INT);\n');
    const compressed = zlib.gzipSync(sql);
    fs.writeFileSync(artifactPath, compressed);
    const expectedSha256 = crypto.createHash('sha256').update(compressed).digest('hex');
    const restoredChunks = [];
    const spawn = jest.fn(() => {
      const child = new EventEmitter();
      child.killed = false;
      child.kill = jest.fn(() => { child.killed = true; });
      child.stdout = new stream.PassThrough();
      child.stderr = new stream.PassThrough();
      child.stdin = new stream.Writable({
        write(chunk, encoding, callback) {
          restoredChunks.push(Buffer.from(chunk));
          callback();
        }
      });
      child.stdin.once('finish', () => setImmediate(() => child.emit('close', 0)));
      return child;
    });
    try {
      await expect(restoreGzip({
        dumpPath: artifactPath,
        expectedSha256,
        containerId: 'a'.repeat(64),
        targetDatabase: 'erp_restore_smoke_fixture',
        spawn
      })).resolves.toEqual({
        sha256: expectedSha256,
        compressedBytes: compressed.length
      });
      expect(Buffer.concat(restoredChunks)).toEqual(sql);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('docker run 使用随机名称和标签、network none，且无端口、挂载或业务目标参数', () => {
    const context = createRunContext((size) => Buffer.alloc(size, 7));
    const args = buildDockerRunArgs(loadConfig(validEnv()), context, 'C:\\isolated\\container.env');
    expect(context.containerName).toMatch(/^erp-db-restore-smoke-[a-f0-9]{24}$/);
    expect(context.targetDatabase).toMatch(/^erp_restore_smoke_[a-f0-9]{24}$/);
    expect(args).toEqual(expect.arrayContaining([
      'run', '-d', '--name', context.containerName,
      '--label', `erp.restore-smoke.run=${context.id}`,
      '--network', 'none', '--pull', 'never',
      '--env-file', 'C:\\isolated\\container.env', PINNED_IMAGE
    ]));
    expect(args).not.toEqual(expect.arrayContaining(['-p', '--publish', '-P', '--volume', '-v', '--mount']));
    expect(args.join(' ')).not.toMatch(/(?:127\.0\.0\.1|3306:|production)/i);
    expect(args.join(' ')).not.toContain(context.rootPassword);
  });

  test('恢复脚本不再生成第二份 dump，源库密码仍只写入 cnf', () => {
    const cnf = sourceCnfContents(loadConfig(validEnv()).source);
    expect(cnf).toContain('password="very-secret-password"');
    expect(cnf).not.toMatch(/^database=/m);
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-db-restore-smoke.js'),
      'utf8'
    );
    expect(source).not.toMatch(/mysqldump|streamDumpToGzip|buildDumpArgs/);
  });

  test('SHOW GRANTS 只接受只读白名单，拒绝写、DDL、ALL 和 GRANT OPTION', () => {
    expect(validateReadOnlyGrants([
      "GRANT USAGE ON *.* TO `erp_backup_reader`@`%`",
      "GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `erp`.* TO `erp_backup_reader`@`%`",
      "GRANT `SHOW_ROUTINE` ON *.* TO `erp_backup_reader`@`%`"
    ], 'erp')).toBe(true);
    for (const grant of [
      "GRANT SELECT, INSERT ON `erp`.* TO `reader`@`%`",
      "GRANT SELECT, ALTER ON `erp`.* TO `reader`@`%`",
      "GRANT EXECUTE ON `erp`.* TO `reader`@`%`",
      "GRANT LOCK TABLES ON `erp`.* TO `reader`@`%`",
      "GRANT ALL PRIVILEGES ON *.* TO `reader`@`%`",
      "GRANT SELECT ON `erp`.* TO `reader`@`%` WITH GRANT OPTION"
    ]) {
      expect(() => validateReadOnlyGrants([grant], 'erp')).toThrow(expect.objectContaining({
        code: 'DB_RESTORE_SOURCE_PRIVILEGE_FORBIDDEN',
        exitCode: EXIT_CODES.SOURCE_ACCESS
      }));
    }
    for (const grant of [
      "GRANT SELECT ON *.* TO `reader`@`%`",
      "GRANT SELECT ON `other_db`.* TO `reader`@`%`"
    ]) {
      expect(() => validateReadOnlyGrants([grant], 'erp')).toThrow(
        expect.objectContaining({ code: 'DB_RESTORE_SOURCE_SCOPE_FORBIDDEN' })
      );
    }
  });

  test.each([
    ['CREATE DATABASE stolen;'],
    ['DROP\n DATABASE `erp`;'],
    ['USE `production`;'],
    ['CREATE USER evil IDENTIFIED BY \'x\';'],
    ['GRANT SELECT ON *.* TO evil;'],
    ['SET @@GLOBAL.read_only = 0;'],
    ['/*!80000 DROP DATABASE hidden */;'],
    ['/* harmless *', '/ DR', 'OP DATABASE after_comment;'],
    ['CRE', 'ATE /* split */ DATA', 'BASE x;']
  ])('流式扫描阻断危险 SQL %#', (...chunks) => {
    expect(() => assertSqlSafe(chunks)).toThrow(expect.objectContaining({
      code: 'DB_RESTORE_DANGEROUS_SQL',
      exitCode: EXIT_CODES.DUMP
    }));
  });

  test('危险词位于字符串、反引号或注释内时不误报', () => {
    expect(assertSqlSafe([
      "INSERT INTO audit(message) VALUES ('DROP DATABASE x; GRANT');\n",
      '-', '- CREATE USER ignored\n',
      'CREATE TABLE `use` (`grant` varchar(20));\n',
      '/', '* SET GLOBAL ignored *', '/ INSERT INTO `use` VALUES (\'ok\');'
    ])).toBe(true);
  });

  test('源和目标 server_uuid 必须非空且不同', () => {
    expect(assertDifferentServerUuids('aaaaaaaa-bbbb', 'cccccccc-dddd')).toBe(true);
    expect(() => assertDifferentServerUuids('', 'cccc')).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_SERVER_UUID_MISSING' })
    );
    expect(() => assertDifferentServerUuids('SAME-UUID', 'same-uuid')).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_SERVER_UUID_MATCH' })
    );
  });

  test('元数据 SQL 和快照比较覆盖要求的所有精确签名层', () => {
    const source = validSnapshot();
    expect(compareSnapshots(source, JSON.parse(JSON.stringify(source)))).toBe(true);
    const changed = JSON.parse(JSON.stringify(source));
    changed.constraints.push({ table_name: 'payments', constraint_name: 'fk_missing' });
    expect(() => compareSnapshots(source, changed)).toThrow(expect.objectContaining({
      code: 'DB_RESTORE_SNAPSHOT_MISMATCH'
    }));
    const script = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-db-restore-smoke.js'),
      'utf8'
    );
    for (const section of [
      'columns', 'statistics', 'table_constraints', 'check_constraints',
      'triggers', 'routines', 'parameters', 'events'
    ]) {
      expect(script).toContain(`information_schema.${section}`);
    }
    expect(buildMetadataQuery({
      columns: ['table_name'], from: 'information_schema.tables', where: '1=1', order: 'table_name'
    })).toContain('JSON_ARRAYAGG');
  });

  test('源库演练前后全表精确行数必须相同', () => {
    const before = validSnapshot().rowCounts;
    expect(assertSourceRowsUnchanged(before, [...before].reverse())).toBe(true);
    expect(() => assertSourceRowsUnchanged(before, [
      ...before.slice(0, -1),
      { table_name: 'performance_imports', row_count: '7' }
    ])).toThrow(expect.objectContaining({ code: 'DB_RESTORE_SOURCE_CHANGED' }));
  });

  test('断言五个关键唯一索引、STORED 生成列和 payments.account_id nullable', () => {
    const snapshot = validSnapshot();
    expect(assertCriticalStructures(snapshot)).toBe(true);

    const missingIndex = JSON.parse(JSON.stringify(snapshot));
    missingIndex.indexes.pop();
    expect(() => assertCriticalStructures(missingIndex)).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_CRITICAL_INDEX_MISSING' })
    );

    const virtualColumn = JSON.parse(JSON.stringify(snapshot));
    virtualColumn.columns[0].extra = 'VIRTUAL GENERATED';
    expect(() => assertCriticalStructures(virtualColumn)).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_GENERATED_COLUMN_INVALID' })
    );

    const requiredAccount = JSON.parse(JSON.stringify(snapshot));
    requiredAccount.columns[1].is_nullable = 'NO';
    expect(() => assertCriticalStructures(requiredAccount)).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_PAYMENT_ACCOUNT_NOT_NULLABLE' })
    );
  });

  test('源和目标快照只允许 InnoDB 业务表', () => {
    const snapshot = validSnapshot();
    expect(assertInnoDbTables(snapshot)).toBe(true);
    snapshot.objects[0].engine = 'MyISAM';
    expect(() => assertInnoDbTables(snapshot)).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_NON_INNODB_TABLE' })
    );
  });

  test('finally 只按保存的完整 container id 执行 docker rm -f，并精确删除本次临时目录', async () => {
    const containerId = 'b'.repeat(64);
    const tempDir = path.join(require('os').tmpdir(), 'erp-db-restore-smoke-abc123');
    const runCommand = jest.fn(async () => ({ stdout: '' }));
    const fsApi = { rm: jest.fn(async () => {}) };
    await cleanupExactResources({ containerId, tempDir, runCommand, fsApi });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('docker', ['rm', '-f', containerId]);
    expect(fsApi.rm).toHaveBeenCalledWith(path.resolve(tempDir), { recursive: true, force: true });
    const allArguments = JSON.stringify(runCommand.mock.calls);
    expect(allArguments).not.toMatch(/docker\s+(?:ps|container\s+ls)|list|\*/i);
    expect(() => validateContainerId('short-id')).toThrow(
      expect.objectContaining({ code: 'DB_RESTORE_CONTAINER_ID_INVALID' })
    );
  });

  test('拒绝清理任意目录，且源文件没有 docker ps/list/通配目标清理', async () => {
    await expect(cleanupExactResources({
      tempDir: path.resolve(require('os').tmpdir(), '..', 'business-data'),
      runCommand: jest.fn(),
      fsApi: { rm: jest.fn() }
    })).rejects.toMatchObject({ code: 'DB_RESTORE_TEMP_CLEANUP_FAILED' });
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-db-restore-smoke.js'),
      'utf8'
    );
    expect(source).not.toMatch(/['"](?:ps|container\s+ls|container\s+prune)['"]/);
    expect(source).not.toMatch(/docker[^\n]*(?:\*|--filter|--all)/i);
  });

  test('分层退出码和 JSON 错误摘要不泄露密码或源连接信息', async () => {
    const env = validEnv({
      COS_BACKUP_RESTORE_SECRET_ID: 'restore-secret-id',
      COS_BACKUP_RESTORE_SECRET_KEY: 'restore-secret-key',
      COS_BACKUP_RESTORE_SECURITY_TOKEN: 'restore-security-token'
    });
    const output = { log: jest.fn(), error: jest.fn() };
    const runner = jest.fn(async () => {
      throw new DbRestoreSmokeError(
        'DB_RESTORE_DUMP_FAILED',
        `failed ${env.DB_BACKUP_PASSWORD} ${env.DB_BACKUP_USER}@${env.DB_BACKUP_HOST}/${env.DB_BACKUP_NAME} ` +
          `${env.COS_BACKUP_RESTORE_SECRET_ID} ${env.COS_BACKUP_RESTORE_SECRET_KEY} ` +
          `${env.COS_BACKUP_RESTORE_SECURITY_TOKEN} ${env.DB_RESTORE_RECEIPT_PATH}`,
        EXIT_CODES.DUMP
      );
    });
    await expect(main({ env, output, runner })).resolves.toBe(EXIT_CODES.DUMP);
    const line = output.error.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ ok: false, code: 'DB_RESTORE_DUMP_FAILED' });
    expect(line).not.toContain(env.DB_BACKUP_PASSWORD);
    expect(line).not.toContain(env.DB_BACKUP_USER);
    expect(line).not.toContain(env.DB_BACKUP_HOST);
    expect(line).not.toContain(env.COS_BACKUP_RESTORE_SECRET_ID);
    expect(line).not.toContain(env.COS_BACKUP_RESTORE_SECRET_KEY);
    expect(line).not.toContain(env.COS_BACKUP_RESTORE_SECURITY_TOKEN);
    expect(line).not.toContain(env.DB_RESTORE_RECEIPT_PATH);
    expect(redactSensitiveText(`password=${env.DB_BACKUP_PASSWORD}`, env)).not.toContain(env.DB_BACKUP_PASSWORD);
  });
});
