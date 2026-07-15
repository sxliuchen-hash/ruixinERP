'use strict';

const fs = require('fs');
const path = require('path');
const {
  MIN_FREE_BYTES,
  REQUIRED_COMMANDS,
  loadReleasePrecheckConfig,
  readNginxCandidate,
  validateNginxCandidateSource,
  runReleasePrecheck
} = require('../src/services/releasePrecheckService');
const releaseCli = require('../scripts/run-release-precheck');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMMIT = 'a'.repeat(40);
const RESTORE_IMAGE = `mysql:8.4.0@sha256:${'c'.repeat(64)}`;
const VALID_NGINX = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'nginx.conf'), 'utf8');

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BACKUP_DIR: REPO_ROOT,
    RELEASE_MIN_FREE_BYTES: String(MIN_FREE_BYTES),
    DB_RESTORE_MYSQL_IMAGE: RESTORE_IMAGE,
    ...overrides
  };
}

function successfulRuntimeResult(overrides = {}) {
  return {
    ok: true,
    redisChecked: true,
    databaseSchemaChecked: true,
    employeeIndexChecked: true,
    payrollSchemaChecked: true,
    warnings: [],
    ...overrides
  };
}

function createCommandRunner({
  commit = COMMIT,
  dirty = '',
  missingCommand = '',
  tracked = true,
  root = REPO_ROOT
} = {}) {
  const calls = [];
  const runner = jest.fn((command, args) => {
    calls.push([command, args]);
    if (command === missingCommand) return { status: 127, stdout: '', stderr: '' };
    if (command !== 'git') return { status: 0, stdout: 'version', stderr: '' };
    if (args[0] === '--version') return { status: 0, stdout: 'git version', stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return { status: 0, stdout: `${root}\n`, stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: `${commit}\n`, stderr: '' };
    }
    if (args[0] === 'ls-files') {
      return { status: tracked ? 0 : 1, stdout: tracked ? 'deploy/nginx.conf\n' : '', stderr: '' };
    }
    if (args[0] === 'status') return { status: 0, stdout: dirty, stderr: '' };
    return { status: 2, stdout: '', stderr: '' };
  });
  return { runner, calls };
}

function buildConfig(options = {}) {
  return loadReleasePrecheckConfig({
    env: validEnv(options.env),
    repoRoot: REPO_ROOT,
    expectedCommit: options.expectedCommit || COMMIT,
    nginxCandidate: path.join(REPO_ROOT, 'deploy', 'nginx.conf'),
    allowDirtyDevelopment: options.allowDirtyDevelopment || false
  });
}

describe('只读 release precheck', () => {
  test('成功时只执行固定只读命令，并完成 candidate、磁盘、DB 与 Redis 门禁', async () => {
    const config = buildConfig();
    const commands = createCommandRunner();
    const runtimePreflight = jest.fn().mockResolvedValue(successfulRuntimeResult());

    await expect(runReleasePrecheck({
      config,
      commandRunner: commands.runner,
      readFile: jest.fn(() => VALID_NGINX),
      statfs: jest.fn(() => ({ bavail: MIN_FREE_BYTES, bsize: 2 })),
      runtimePreflight
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      commit: COMMIT,
      nginxCandidate: 'deploy/nginx.conf',
      runtime: {
        redisChecked: true,
        databaseSchemaChecked: true,
        payrollSchemaChecked: true
      }
    }));

    const calls = commands.runner.mock.calls.map(([command, args]) => [command, args]);
    expect(calls).toEqual(expect.arrayContaining([
      ['git', ['rev-parse', '--show-toplevel']],
      ['git', ['rev-parse', 'HEAD']],
      ['git', ['status', '--porcelain=v1', '--untracked-files=all']],
      ['git', ['ls-files', '--error-unmatch', '--', 'deploy/nginx.conf']]
    ]));
    expect(calls).toEqual(expect.arrayContaining([
      ['docker', ['info', '--format', '{{.ServerVersion}}']],
      ['docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', RESTORE_IMAGE]]
    ]));
    expect(new Set(calls.map(([command]) => command))).toEqual(
      new Set(['git', ...REQUIRED_COMMANDS.map(([command]) => command)])
    );
    expect(runtimePreflight).toHaveBeenCalledWith(expect.objectContaining({
      cwd: path.join(REPO_ROOT, 'backend'),
      env: expect.objectContaining({
        NODE_ENV: 'production',
        UNIFIED_AUTH_PREFLIGHT_CHECK_DB: 'true',
        UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS: 'true'
      })
    }));
  });

  test.each([
    ['Commit 不匹配', { commandOptions: { commit: 'b'.repeat(40) } }, 'RELEASE_COMMIT_MISMATCH'],
    ['工作树不干净', { commandOptions: { dirty: ' M backend/src/app.js\n?? local.txt\n' } }, 'RELEASE_TREE_DIRTY'],
    ['candidate 未被 Commit 跟踪', { commandOptions: { tracked: false } }, 'NGINX_CANDIDATE_NOT_TRACKED'],
    ['缺少发布命令', { commandOptions: { missingCommand: 'docker' } }, 'RELEASE_COMMAND_MISSING'],
    ['备份卷空间不足', { freeBlocks: 1 }, 'RELEASE_DISK_SPACE_LOW']
  ])('%s 时 fail-closed 且不会连接 DB/Redis', async (_label, setup, expectedCode) => {
    const config = buildConfig();
    const commands = createCommandRunner(setup.commandOptions);
    const runtimePreflight = jest.fn();

    await expect(runReleasePrecheck({
      config,
      commandRunner: commands.runner,
      readFile: () => VALID_NGINX,
      statfs: () => ({ bavail: setup.freeBlocks ?? MIN_FREE_BYTES, bsize: 1 }),
      runtimePreflight
    })).rejects.toMatchObject({
      code: 'RELEASE_PRECHECK_FAILED',
      issues: expect.arrayContaining([expect.objectContaining({ code: expectedCode })])
    });
    expect(runtimePreflight).not.toHaveBeenCalled();
  });

  test('生产拒绝 dirty 绕过，非生产单测必须显式启用', () => {
    expect(() => buildConfig({ allowDirtyDevelopment: true })).toThrow(expect.objectContaining({
      code: 'RELEASE_DIRTY_BYPASS_FORBIDDEN'
    }));

    expect(loadReleasePrecheckConfig({
      env: validEnv({ NODE_ENV: 'test' }),
      repoRoot: REPO_ROOT,
      expectedCommit: COMMIT,
      allowDirtyDevelopment: true
    })).toEqual(expect.objectContaining({ allowDirtyDevelopment: true }));
  });

  test('dirty development 模式不能调用真实 runtime preflight', async () => {
    const config = loadReleasePrecheckConfig({
      env: validEnv({ NODE_ENV: 'test' }),
      repoRoot: REPO_ROOT,
      expectedCommit: COMMIT,
      allowDirtyDevelopment: true
    });
    const commands = createCommandRunner({ dirty: ' M backend/src/app.js\n' });
    await expect(runReleasePrecheck({
      config,
      commandRunner: commands.runner,
      readFile: () => VALID_NGINX,
      statfs: () => ({ bavail: MIN_FREE_BYTES, bsize: 2 })
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'RELEASE_DEVELOPMENT_RUNTIME_FORBIDDEN' })
      ])
    });
  });

  test.each([
    ['', 'RELEASE_EXPECTED_COMMIT_INVALID'],
    ['HEAD', 'RELEASE_EXPECTED_COMMIT_INVALID'],
    ['abc123', 'RELEASE_EXPECTED_COMMIT_INVALID']
  ])('拒绝非完整精确 Commit：%s', (expectedCommit, code) => {
    expect(() => loadReleasePrecheckConfig({
      env: validEnv(),
      repoRoot: REPO_ROOT,
      expectedCommit
    })).toThrow(expect.objectContaining({ code }));
  });

  test('拒绝仓库外 candidate 和相对 BACKUP_DIR', () => {
    expect(() => loadReleasePrecheckConfig({
      env: validEnv(),
      repoRoot: REPO_ROOT,
      expectedCommit: COMMIT,
      nginxCandidate: path.resolve(REPO_ROOT, '..', 'outside.conf')
    })).toThrow(expect.objectContaining({ code: 'RELEASE_NGINX_CANDIDATE_OUTSIDE_REPO' }));

    expect(() => loadReleasePrecheckConfig({
      env: validEnv({ BACKUP_DIR: 'relative/backups' }),
      repoRoot: REPO_ROOT,
      expectedCommit: COMMIT
    })).toThrow(expect.objectContaining({ code: 'RELEASE_BACKUP_DIR_INVALID' }));
  });

  test('恢复镜像必须固定 digest；Docker daemon 或本地镜像不可用时 fail-closed', async () => {
    expect(() => loadReleasePrecheckConfig({
      env: validEnv({ DB_RESTORE_MYSQL_IMAGE: 'mysql:8.4' }),
      repoRoot: REPO_ROOT,
      expectedCommit: COMMIT
    })).toThrow(expect.objectContaining({ code: 'RELEASE_RESTORE_IMAGE_NOT_PINNED' }));

    const config = buildConfig();
    const base = createCommandRunner();
    const daemonDown = jest.fn((command, args, options) => {
      if (command === 'docker' && args[0] === 'info') return { status: 1, stdout: '', stderr: '' };
      return base.runner(command, args, options);
    });
    await expect(runReleasePrecheck({
      config,
      commandRunner: daemonDown,
      readFile: () => VALID_NGINX,
      statfs: () => ({ bavail: MIN_FREE_BYTES, bsize: 2 }),
      runtimePreflight: jest.fn()
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'RELEASE_DOCKER_DAEMON_UNAVAILABLE' })
      ])
    });

    const imageMissing = jest.fn((command, args, options) => {
      if (command === 'docker' && args[0] === 'image') return { status: 1, stdout: '', stderr: '' };
      return base.runner(command, args, options);
    });
    await expect(runReleasePrecheck({
      config,
      commandRunner: imageMissing,
      readFile: () => VALID_NGINX,
      statfs: () => ({ bavail: MIN_FREE_BYTES, bsize: 2 }),
      runtimePreflight: jest.fn()
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'RELEASE_RESTORE_IMAGE_UNAVAILABLE' })
      ])
    });
  });

  test('Nginx 静态校验不能由注释伪造，并拒绝业务 503 拦截及内嵌凭证', () => {
    const invalid = `
      # server_tokens off;
      # listen 443 ssl;
      error_page 503 = @fallback;
      proxy_pass https://operator:password@example.internal;
      proxy_set_header X-ERP-Service-Secret literal-secret;
    `;
    const codes = validateNginxCandidateSource(invalid).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      'NGINX_SERVER_TOKENS_MISSING',
      'NGINX_TLS_SERVER_MISSING',
      'NGINX_BUSINESS_503_INTERCEPTED',
      'NGINX_URL_CREDENTIAL_EMBEDDED',
      'NGINX_LITERAL_CREDENTIAL_HEADER'
    ]));
    expect(validateNginxCandidateSource(VALID_NGINX)).toEqual([]);
    expect(validateNginxCandidateSource(`${VALID_NGINX}\nserver {`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NGINX_BRACES_UNBALANCED' })])
    );
  });

  test('Nginx candidate 必须是普通文件，拒绝符号链接', () => {
    expect(readNginxCandidate(buildConfig(), {
      lstat: () => ({ isSymbolicLink: () => true, isFile: () => false }),
      readFile: jest.fn()
    })).toEqual([
      expect.objectContaining({ code: 'NGINX_CANDIDATE_FILE_TYPE_INVALID' })
    ]);
  });

  test('运行 preflight 失败时不输出底层 Secret，结果不完整同样拒绝', async () => {
    const config = buildConfig();
    const commands = createCommandRunner();
    const secret = 'do-not-print-this-secret';
    const failure = Object.assign(new Error(secret), {
      issues: [{ code: 'REDIS_UNAVAILABLE', message: secret }]
    });

    let caught;
    try {
      await runReleasePrecheck({
        config,
        commandRunner: commands.runner,
        readFile: () => VALID_NGINX,
        statfs: () => ({ bavail: MIN_FREE_BYTES, bsize: 2 }),
        runtimePreflight: jest.fn().mockRejectedValue(failure)
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'RELEASE_PRECHECK_FAILED',
      issues: [expect.objectContaining({ code: 'REDIS_UNAVAILABLE' })]
    });
    expect(JSON.stringify(caught)).not.toContain(secret);

    await expect(runReleasePrecheck({
      config,
      commandRunner: commands.runner,
      readFile: () => VALID_NGINX,
      statfs: () => ({ bavail: MIN_FREE_BYTES, bsize: 2 }),
      runtimePreflight: jest.fn().mockResolvedValue(successfulRuntimeResult({ redisChecked: false }))
    })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'RUNTIME_PREFLIGHT_INCOMPLETE' })]
    });
  });

  test('CLI 参数严格解析，成功和失败都返回确定退出码', async () => {
    expect(releaseCli.parseArgs([
      '--expected-commit', COMMIT,
      '--nginx-candidate=deploy/nginx.conf',
      '--allow-dirty-development'
    ])).toEqual({
      expectedCommit: COMMIT,
      nginxCandidate: 'deploy/nginx.conf',
      allowDirtyDevelopment: true
    });
    expect(() => releaseCli.parseArgs(['--unknown'])).toThrow(expect.objectContaining({
      code: 'RELEASE_ARGUMENT_UNKNOWN'
    }));

    const output = { log: jest.fn(), error: jest.fn() };
    await expect(releaseCli.main({
      args: ['--expected-commit', COMMIT],
      env: validEnv(),
      output,
      execute: jest.fn().mockResolvedValue({
        commit: COMMIT,
        nginxCandidate: 'deploy/nginx.conf',
        backupDiskFreeBytes: MIN_FREE_BYTES,
        warnings: []
      })
    })).resolves.toBe(0);
    expect(output.error).not.toHaveBeenCalled();

    await expect(releaseCli.main({
      args: ['--expected-commit', 'HEAD'],
      env: validEnv(),
      output
    })).resolves.toBe(1);
  });
});
