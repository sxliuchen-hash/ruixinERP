'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const {
  EXIT_CODES,
  DUMP_PROFILE_VERSION,
  loadConfig,
  createBackupId,
  createClient,
  uploadAndVerify,
  buildReceipt,
  writeReceiptAtomic,
  main
} = require('../scripts/upload-backup-to-cos');

describe('数据库备份 COS 上传与 HEAD 校验', () => {
  let tempDir;
  let backupFile;
  let fileSize;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-backup-cos-test-'));
    backupFile = path.join(tempDir, 'erp_db_20260711_120000.sql.gz');
    fs.writeFileSync(backupFile, Buffer.from('gzip-fixture'));
    fileSize = fs.statSync(backupFile).size;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function env(overrides = {}) {
    return {
      COS_BACKUP_SECRET_ID: 'backup-secret-id',
      COS_BACKUP_SECRET_KEY: 'backup-secret-key',
      COS_BACKUP_BUCKET: 'erp-db-backup-1250000000',
      COS_BACKUP_REGION: 'ap-guangzhou',
      COS_BUCKET: 'erp-business-1250000000',
      BACKUP_FILE: backupFile,
      BACKUP_SIZE: String(fileSize),
      BACKUP_SHA256: 'a'.repeat(64),
      BACKUP_OBJECT_KEY: 'erp-backups/db/erp_db_20260711_120000.sql.gz',
      BACKUP_DIR: tempDir,
      BACKUP_RECEIPT_PATH: `${backupFile}.receipt.json`,
      BACKUP_CREATED_AT: '2026-07-11T04:00:00Z',
      BACKUP_DATABASE_NAME: 'erp_db',
      BACKUP_SOURCE_SERVER_UUID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      BACKUP_DUMP_PROFILE_VERSION: DUMP_PROFILE_VERSION,
      ...overrides
    };
  }

  function memoryFileSystem() {
    return {
      createReadStream: jest.fn(() => Buffer.from('gzip-fixture'))
    };
  }

  test.each([
    ['业务桶复用', { COS_BACKUP_BUCKET: 'ERP-BUSINESS-1250000000' }, 'COS_BACKUP_BUCKET_REUSED'],
    ['任意对象 Key', { BACKUP_OBJECT_KEY: 'other/path/file.sql.gz' }, 'COS_BACKUP_OBJECT_KEY_INVALID'],
    ['非法摘要', { BACKUP_SHA256: 'not-a-hash' }, 'COS_BACKUP_SHA256_INVALID'],
    ['业务凭证回退', {
      COS_BACKUP_SECRET_ID: '',
      COS_SECRET_ID: 'business-id'
    }, 'COS_BACKUP_CONFIG_MISSING']
  ])('拒绝%s', (_label, overrides, code) => {
    expect(() => loadConfig(env(overrides))).toThrow(expect.objectContaining({ code }));
  });

  test('拒绝与本地文件不一致的 BACKUP_SIZE', () => {
    expect(() => loadConfig(env({ BACKUP_SIZE: String(fileSize + 1) }))).toThrow(
      expect.objectContaining({ code: 'COS_BACKUP_LOCAL_SIZE_MISMATCH' })
    );
  });

  test('Linux 下 uploader 独立执行也强制 BACKUP_DIR 私有且 artifact 为 0600', () => {
    function fakeFileSystem(dirMode, artifactMode) {
      return {
        lstatSync(target) {
          if (target === tempDir) {
            return {
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
              mode: dirMode
            };
          }
          if (target === backupFile) {
            return {
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
              mode: artifactMode
            };
          }
          const error = new Error('not found');
          error.code = 'ENOENT';
          throw error;
        },
        statSync: () => ({ isFile: () => true, size: fileSize })
      };
    }
    expect(() => loadConfig(env(), fakeFileSystem(0o40755, 0o100600), 'linux'))
      .toThrow(expect.objectContaining({ code: 'COS_BACKUP_DIR_MODE_INVALID' }));
    expect(() => loadConfig(env(), fakeFileSystem(0o40700, 0o100644), 'linux'))
      .toThrow(expect.objectContaining({ code: 'COS_BACKUP_FILE_MODE_INVALID' }));
    expect(loadConfig(env(), fakeFileSystem(0o40700, 0o100600), 'linux'))
      .toMatchObject({ filePath: backupFile, backupDir: tempDir });
  });

  test('只使用独立备份凭证创建 SDK Client', () => {
    const client = {};
    const COSClass = jest.fn(() => client);
    const config = loadConfig(env());

    expect(createClient(config, COSClass)).toBe(client);
    expect(COSClass).toHaveBeenCalledWith({
      SecretId: 'backup-secret-id',
      SecretKey: 'backup-secret-key'
    });
  });

  test('backupId 由 CSPRNG UUID 生成，不使用时间或摘要拼接', () => {
    expect(createBackupId(() => '123e4567-e89b-42d3-a456-426614174000'))
      .toBe('erp-123e4567-e89b-42d3-a456-426614174000');
    expect(() => createBackupId(() => 'predictable-id')).toThrow(
      expect.objectContaining({ code: 'COS_BACKUP_RANDOM_ID_INVALID' })
    );
  });

  test('put 使用固定 Key、内容长度、gzip 类型和 SHA256 元数据，再执行 HEAD', async () => {
    const config = loadConfig(env());
    const client = {
      putObject: jest.fn((params, callback) => callback(null, { statusCode: 200 })),
      headObject: jest.fn((params, callback) => callback(null, {
        headers: {
          'content-length': String(fileSize),
          'x-cos-meta-sha256': 'a'.repeat(64)
        }
      }))
    };

    await expect(uploadAndVerify({
      config,
      client,
      fileSystem: memoryFileSystem()
    })).resolves.toMatchObject({
      ok: true,
      key: config.objectKey,
      size: fileSize,
      sha256: 'a'.repeat(64)
    });
    expect(client.putObject).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: 'erp-db-backup-1250000000',
      Region: 'ap-guangzhou',
      Key: 'erp-backups/db/erp_db_20260711_120000.sql.gz',
      Body: expect.anything(),
      ContentLength: fileSize,
      ContentType: 'application/gzip',
      Headers: { 'x-cos-meta-sha256': 'a'.repeat(64) }
    }), expect.any(Function));
    expect(client.headObject).toHaveBeenCalledWith({
      Bucket: 'erp-db-backup-1250000000',
      Region: 'ap-guangzhou',
      Key: 'erp-backups/db/erp_db_20260711_120000.sql.gz'
    }, expect.any(Function));
  });

  test.each([
    ['size', 'COS_BACKUP_HEAD_SIZE_MISMATCH'],
    ['hash', 'COS_BACKUP_HEAD_SHA256_MISMATCH']
  ])('HEAD 大小或摘要不一致时 fail-closed', async (mismatch, code) => {
    const config = loadConfig(env());
    const remoteSize = mismatch === 'size' ? String(fileSize + 1) : String(fileSize);
    const remoteHash = mismatch === 'hash' ? 'b'.repeat(64) : 'a'.repeat(64);
    const client = {
      putObject: jest.fn((params, callback) => callback(null, {})),
      headObject: jest.fn((params, callback) => callback(null, {
        headers: {
          'content-length': remoteSize,
          'x-cos-meta-sha256': remoteHash
        }
      }))
    };

    await expect(uploadAndVerify({
      config,
      client,
      fileSystem: memoryFileSystem()
    })).rejects.toMatchObject({
      code,
      exitCode: EXIT_CODES.VERIFY
    });
  });

  test('HEAD 成功后构建完整 receipt 并以 0600 原子落盘', async () => {
    const config = loadConfig(env());
    const uploadResult = {
      headMetadata: {
        contentLength: String(fileSize),
        sha256: 'a'.repeat(64),
        contentType: 'application/gzip'
      },
      etag: '"etag-value"',
      versionId: 'version-1'
    };
    const receipt = buildReceipt(config, uploadResult);
    const openSpy = jest.spyOn(fs, 'openSync');
    const chmodSpy = jest.spyOn(fs, 'chmodSync');

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      backupId: expect.stringMatching(/^erp-[a-f0-9-]{36}$/),
      databaseName: 'erp_db',
      sourceServerUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      artifact: {
        absolutePath: backupFile,
        filename: path.basename(backupFile),
        bytes: fileSize,
        sha256: 'a'.repeat(64)
      },
      cos: {
        objectKey: 'erp-backups/db/erp_db_20260711_120000.sql.gz',
        etag: '"etag-value"',
        versionId: 'version-1',
        uploaderCredentialIdSha256: crypto.createHash('sha256')
          .update('backup-secret-id')
          .digest('hex')
      },
      dumpProfileVersion: DUMP_PROFILE_VERSION
    });
    writeReceiptAtomic(config.receiptPath, receipt);
    const stats = fs.lstatSync(config.receiptPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600);
    } else {
      expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\.part$/), 'wx', 0o600);
      expect(chmodSpy).toHaveBeenCalledWith(config.receiptPath, 0o600);
    }
    expect(JSON.parse(fs.readFileSync(config.receiptPath, 'utf8'))).toEqual(receipt);
    expect(fs.readdirSync(tempDir).filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  test('CLI 失败日志不包含 Secret、文件路径或 SDK 错误正文', async () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const COSClass = jest.fn(() => ({
      putObject: jest.fn((params, callback) => {
        params.Body.on('error', () => {});
        params.Body.resume();
        params.Body.on('end', () => callback(
          Object.assign(new Error(`leak ${backupFile} backup-secret-key`), { code: 'AccessDenied' })
        ));
      }),
      headObject: jest.fn()
    }));

    await expect(main({ env: env(), output, COSClass })).resolves.toBe(EXIT_CODES.UPLOAD);
    const errorLine = output.error.mock.calls.flat().join('\n');
    expect(errorLine).toContain('[COS_BACKUP_UPLOAD_FAILED]');
    expect(errorLine).not.toContain('backup-secret');
    expect(errorLine).not.toContain(backupFile);
    expect(errorLine).not.toContain('AccessDenied');
  });
});
