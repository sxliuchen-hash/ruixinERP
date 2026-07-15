'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runUnifiedAuthPreflight } = require('./unifiedAuthPreflightService');

const DEFAULT_MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const MAX_FREE_BYTES = 10 * 1024 * 1024 * 1024 * 1024;
const MAX_NGINX_CANDIDATE_BYTES = 1024 * 1024;
const REQUIRED_COMMANDS = Object.freeze([
  ['git', ['--version']],
  ['node', ['--version']],
  ['npm', ['--version']],
  ['nginx', ['-v']],
  ['mysqldump', ['--version']],
  ['gzip', ['--version']],
  ['sha256sum', ['--version']],
  ['flock', ['--version']],
  ['docker', ['--version']]
]);

class ReleasePrecheckError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'ReleasePrecheckError';
    this.code = code;
    this.issues = issues;
    this.isOperational = true;
  }
}

function issue(code, message) {
  return { code, message };
}

function parseMinFreeBytes(value) {
  if (value === undefined || value === '') return DEFAULT_MIN_FREE_BYTES;
  if (!/^\d+$/.test(String(value))) {
    throw new ReleasePrecheckError(
      'RELEASE_MIN_FREE_BYTES_INVALID',
      `RELEASE_MIN_FREE_BYTES 必须是 ${MIN_FREE_BYTES}-${MAX_FREE_BYTES} 的整数`
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_FREE_BYTES || parsed > MAX_FREE_BYTES) {
    throw new ReleasePrecheckError(
      'RELEASE_MIN_FREE_BYTES_INVALID',
      `RELEASE_MIN_FREE_BYTES 必须是 ${MIN_FREE_BYTES}-${MAX_FREE_BYTES} 的整数`
    );
  }
  return parsed;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function loadReleasePrecheckConfig({
  env = process.env,
  repoRoot = path.resolve(__dirname, '..', '..', '..'),
  expectedCommit,
  nginxCandidate,
  allowDirtyDevelopment = false
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const commit = String(expectedCommit || env.RELEASE_EXPECTED_COMMIT || '').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) {
    throw new ReleasePrecheckError(
      'RELEASE_EXPECTED_COMMIT_INVALID',
      '必须通过 --expected-commit 或 RELEASE_EXPECTED_COMMIT 提供完整的 40/64 位十六进制 Commit'
    );
  }

  if (allowDirtyDevelopment && env.NODE_ENV === 'production') {
    throw new ReleasePrecheckError(
      'RELEASE_DIRTY_BYPASS_FORBIDDEN',
      '--allow-dirty-development 仅供非生产单元测试，生产发布不得跳过 clean tree 门禁'
    );
  }

  const configuredCandidate = nginxCandidate || env.RELEASE_NGINX_CANDIDATE ||
    path.join(resolvedRepoRoot, 'deploy', 'nginx.conf');
  const candidate = path.isAbsolute(configuredCandidate)
    ? path.resolve(configuredCandidate)
    : path.resolve(resolvedRepoRoot, configuredCandidate);
  if (!isPathInside(resolvedRepoRoot, candidate)) {
    throw new ReleasePrecheckError(
      'RELEASE_NGINX_CANDIDATE_OUTSIDE_REPO',
      'Nginx candidate 必须位于本次精确 Commit 覆盖的仓库目录内'
    );
  }

  const configuredBackupDir = env.BACKUP_DIR || '/var/backups/erp';
  if (!path.isAbsolute(configuredBackupDir)) {
    throw new ReleasePrecheckError(
      'RELEASE_BACKUP_DIR_INVALID',
      'BACKUP_DIR 必须是绝对路径'
    );
  }
  const backupDir = path.resolve(configuredBackupDir);
  const restoreImage = String(env.DB_RESTORE_MYSQL_IMAGE || '').trim();
  if (!/^mysql:\d+\.\d+(?:\.\d+)?@sha256:[a-f0-9]{64}$/.test(restoreImage)) {
    throw new ReleasePrecheckError(
      'RELEASE_RESTORE_IMAGE_NOT_PINNED',
      'DB_RESTORE_MYSQL_IMAGE 必须是 mysql:<version>@sha256:<64hex> 的固定镜像'
    );
  }

  return {
    repoRoot: resolvedRepoRoot,
    backendRoot: path.join(resolvedRepoRoot, 'backend'),
    expectedCommit: commit.toLowerCase(),
    nginxCandidate: candidate,
    nginxCandidateRelative: path.relative(resolvedRepoRoot, candidate).split(path.sep).join('/'),
    backupDir,
    restoreImage,
    minFreeBytes: parseMinFreeBytes(env.RELEASE_MIN_FREE_BYTES),
    allowDirtyDevelopment,
    env
  };
}

function defaultCommandRunner(command, args, { cwd }) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
}

function commandSucceeded(result) {
  return result && !result.error && result.status === 0;
}

function runCommand(commandRunner, command, args, cwd) {
  try {
    return commandRunner(command, args, { cwd });
  } catch (error) {
    return { status: null, error };
  }
}

function stripNginxComments(source) {
  return source.split(/\r?\n/).map((line) => {
    let quote = '';
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '#') return line.slice(0, index);
    }
    return line;
  }).join('\n');
}

function validateNginxCandidateSource(source) {
  const issues = [];
  if (Buffer.byteLength(source, 'utf8') > MAX_NGINX_CANDIDATE_BYTES) {
    issues.push(issue('NGINX_CANDIDATE_TOO_LARGE', 'Nginx candidate 超过 1 MiB 静态检查上限'));
    return issues;
  }
  if (source.includes('\0')) {
    issues.push(issue('NGINX_CANDIDATE_BINARY', 'Nginx candidate 不能包含 NUL 字节'));
    return issues;
  }

  const candidate = stripNginxComments(source);
  let braceDepth = 0;
  let braceInvalid = false;
  for (const character of candidate) {
    if (character === '{') braceDepth += 1;
    if (character === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) braceInvalid = true;
    }
  }
  if (braceInvalid || braceDepth !== 0) {
    issues.push(issue('NGINX_BRACES_UNBALANCED', 'Nginx candidate 的配置块括号不平衡'));
  }
  const requiredPatterns = [
    ['NGINX_SERVER_TOKENS_MISSING', /server_tokens\s+off\s*;/, '必须关闭 Nginx 版本暴露'],
    ['NGINX_TLS_SERVER_MISSING', /listen\s+443\s+ssl(?:\s+http2)?\s*;/, '必须包含 HTTPS server'],
    ['NGINX_API_PROXY_INVALID', /proxy_pass\s+http:\/\/127\.0\.0\.1:3001\s*;/, 'API 必须反向代理到固定本机端口'],
    ['NGINX_FORWARDED_PROTO_MISSING', /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/, '必须传递 X-Forwarded-Proto'],
    ['NGINX_API_EDGE_ERROR_INVALID', /error_page\s+502\s+504\s+=\s+@api_upstream_unavailable\s*;/, '只能收敛 upstream 502/504'],
    ['NGINX_CALLBACK_CACHE_GUARD_MISSING', /Cache-Control\s+"[^"]*no-store[^"]*"\s+always\s*;/i, 'SSO callback 必须禁止缓存'],
    ['NGINX_CALLBACK_REFERRER_GUARD_MISSING', /Referrer-Policy\s+"no-referrer"\s+always\s*;/i, 'SSO callback 必须禁止 Referer 泄漏'],
    ['NGINX_SPA_FALLBACK_MISSING', /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/, '必须保留 SPA history fallback'],
    ['NGINX_HTTP_CALLBACK_REJECTION_MISSING', /return\s+400\s+'\{[^']*"code":"HTTPS_REQUIRED"[^']*\}'\s*;/, 'HTTP callback 必须直接拒绝']
  ];

  for (const [code, pattern, message] of requiredPatterns) {
    if (!pattern.test(candidate)) issues.push(issue(code, message));
  }

  const exactCallbackLocations = candidate.match(/location\s*=\s*\/sso\/callback\s*\{/g) || [];
  if (exactCallbackLocations.length < 2) {
    issues.push(issue(
      'NGINX_CALLBACK_LOCATIONS_INCOMPLETE',
      'HTTP 与 HTTPS server 都必须使用 exact /sso/callback location'
    ));
  }
  const accessLogOff = candidate.match(/access_log\s+off\s*;/g) || [];
  if (accessLogOff.length < 2) {
    issues.push(issue('NGINX_CALLBACK_LOG_GUARD_MISSING', 'HTTP/HTTPS callback 不得记录一次性 Code'));
  }
  if (/error_page\s+[^;]*\b503\b[^;]*;/i.test(candidate)) {
    issues.push(issue('NGINX_BUSINESS_503_INTERCEPTED', '不得拦截 ERP 后端主动返回的业务 503'));
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(candidate)) {
    issues.push(issue('NGINX_PRIVATE_KEY_EMBEDDED', 'Nginx candidate 不得内嵌私钥内容'));
  }
  if (/https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(candidate)) {
    issues.push(issue('NGINX_URL_CREDENTIAL_EMBEDDED', 'Nginx candidate URL 不得内嵌账号或凭证'));
  }
  const credentialHeader = /proxy_set_header\s+(Authorization|Proxy-Authorization|[A-Za-z0-9-]*(?:Secret|Token|Api-Key)[A-Za-z0-9-]*)\s+("[^"]*"|'[^']*'|[^;\s]+)\s*;/gi;
  for (const match of candidate.matchAll(credentialHeader)) {
    const value = match[2].replace(/^["']|["']$/g, '').trim();
    if (!value.startsWith('$')) {
      issues.push(issue(
        'NGINX_LITERAL_CREDENTIAL_HEADER',
        'Nginx candidate 不得在 proxy_set_header 中内嵌静态凭证'
      ));
      break;
    }
  }
  return issues;
}

function readNginxCandidate(config, {
  readFile = fs.readFileSync,
  lstat = fs.lstatSync
} = {}) {
  try {
    const stats = lstat(config.nginxCandidate);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return [issue(
        'NGINX_CANDIDATE_FILE_TYPE_INVALID',
        'Nginx candidate 必须是仓库内受 Commit 跟踪的普通文件，不能是符号链接'
      )];
    }
    const source = readFile(config.nginxCandidate, 'utf8');
    return validateNginxCandidateSource(source);
  } catch (_error) {
    return [issue('NGINX_CANDIDATE_UNREADABLE', 'Nginx candidate 无法读取')];
  }
}

function freeBytesFromStatfs(stats) {
  const available = stats?.bavail ?? stats?.bfree;
  const blockSize = stats?.bsize;
  if (typeof available === 'bigint' || typeof blockSize === 'bigint') {
    return Number(BigInt(available) * BigInt(blockSize));
  }
  return Number(available) * Number(blockSize);
}

function checkDiskSpace(config, { statfs = fs.statfsSync } = {}) {
  try {
    const freeBytes = freeBytesFromStatfs(statfs(config.backupDir));
    if (!Number.isSafeInteger(freeBytes) || freeBytes < 0) {
      return { issues: [issue('RELEASE_DISK_RESULT_INVALID', '无法可靠计算备份卷剩余空间')] };
    }
    if (freeBytes < config.minFreeBytes) {
      return {
        issues: [issue(
          'RELEASE_DISK_SPACE_LOW',
          `备份卷可用空间不足，至少需要 ${config.minFreeBytes} 字节`
        )],
        freeBytes
      };
    }
    return { issues: [], freeBytes };
  } catch (_error) {
    return { issues: [issue('RELEASE_BACKUP_DIR_UNAVAILABLE', 'BACKUP_DIR 不存在、不可访问或无法读取磁盘信息')] };
  }
}

function checkRepository(config, commandRunner) {
  const issues = [];
  const rootResult = runCommand(
    commandRunner,
    'git',
    ['rev-parse', '--show-toplevel'],
    config.repoRoot
  );
  const actualRoot = String(rootResult?.stdout || '').trim();
  if (
    !commandSucceeded(rootResult) ||
    !actualRoot ||
    normalizePathForCompare(actualRoot) !== normalizePathForCompare(config.repoRoot)
  ) {
    issues.push(issue('RELEASE_REPOSITORY_INVALID', '指定目录不是预期的 Git 仓库根目录'));
    return { issues, actualCommit: '' };
  }

  const commitResult = runCommand(commandRunner, 'git', ['rev-parse', 'HEAD'], config.repoRoot);
  const actualCommit = String(commitResult?.stdout || '').trim().toLowerCase();
  if (!commandSucceeded(commitResult) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(actualCommit)) {
    issues.push(issue('RELEASE_COMMIT_UNREADABLE', '无法读取当前完整 Commit'));
  } else if (actualCommit !== config.expectedCommit) {
    issues.push(issue('RELEASE_COMMIT_MISMATCH', '当前 Commit 与发布单指定的精确 Commit 不一致'));
  }

  const trackedResult = runCommand(
    commandRunner,
    'git',
    ['ls-files', '--error-unmatch', '--', config.nginxCandidateRelative],
    config.repoRoot
  );
  if (!commandSucceeded(trackedResult)) {
    issues.push(issue('NGINX_CANDIDATE_NOT_TRACKED', 'Nginx candidate 必须由当前 Commit 跟踪'));
  }

  const statusResult = runCommand(
    commandRunner,
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    config.repoRoot
  );
  if (!commandSucceeded(statusResult)) {
    issues.push(issue('RELEASE_TREE_STATUS_FAILED', '无法确认工作树是否干净'));
  } else {
    const dirtyCount = String(statusResult.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .length;
    if (dirtyCount > 0 && !config.allowDirtyDevelopment) {
      issues.push(issue('RELEASE_TREE_DIRTY', `发布工作树不干净（${dirtyCount} 项变更）`));
    }
  }
  return { issues, actualCommit };
}

function checkRequiredCommands(config, commandRunner) {
  const missing = [];
  for (const [command, args] of REQUIRED_COMMANDS) {
    const result = runCommand(commandRunner, command, args, config.repoRoot);
    if (!commandSucceeded(result)) missing.push(command);
  }
  return missing.map((command) => issue(
    'RELEASE_COMMAND_MISSING',
    `发布前置命令不可用：${command}`
  ));
}

function checkDockerRestorePrerequisites(config, commandRunner) {
  const issues = [];
  const daemonResult = runCommand(
    commandRunner,
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    config.repoRoot
  );
  if (!commandSucceeded(daemonResult)) {
    issues.push(issue(
      'RELEASE_DOCKER_DAEMON_UNAVAILABLE',
      'Docker daemon 不可用，不能在进入维护模式前证明隔离恢复能力'
    ));
    return issues;
  }

  const imageResult = runCommand(
    commandRunner,
    'docker',
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', config.restoreImage],
    config.repoRoot
  );
  if (!commandSucceeded(imageResult)) {
    issues.push(issue(
      'RELEASE_RESTORE_IMAGE_UNAVAILABLE',
      '本机不存在发布单指定的固定 digest MySQL 恢复镜像；precheck 不会自动拉取'
    ));
  }
  return issues;
}

function buildReleaseFailure(issues) {
  return new ReleasePrecheckError(
    'RELEASE_PRECHECK_FAILED',
    `只读发布前检查失败，共 ${issues.length} 项`,
    issues
  );
}

async function runReleasePrecheck({
  config,
  commandRunner = defaultCommandRunner,
  readFile = fs.readFileSync,
  statfs = fs.statfsSync,
  runtimePreflight = runUnifiedAuthPreflight
} = {}) {
  if (!config) config = loadReleasePrecheckConfig();
  const issues = [];

  if (config.env.NODE_ENV !== 'production' && !config.allowDirtyDevelopment) {
    issues.push(issue('RELEASE_NODE_ENV_INVALID', '正式发布前检查要求 NODE_ENV=production'));
  }
  if (config.allowDirtyDevelopment && runtimePreflight === runUnifiedAuthPreflight) {
    issues.push(issue(
      'RELEASE_DEVELOPMENT_RUNTIME_FORBIDDEN',
      'dirty development 模式仅供依赖注入单元测试，不得连接真实 DB/Redis'
    ));
  }

  const repository = checkRepository(config, commandRunner);
  issues.push(...repository.issues);
  issues.push(...checkRequiredCommands(config, commandRunner));
  issues.push(...checkDockerRestorePrerequisites(config, commandRunner));
  issues.push(...readNginxCandidate(config, { readFile }));
  const disk = checkDiskSpace(config, { statfs });
  issues.push(...disk.issues);

  // 本地来源、Commit、工具、candidate 或磁盘门禁失败时不连接 DB/Redis。
  if (issues.length > 0) throw buildReleaseFailure(issues);

  let runtimeResult;
  try {
    runtimeResult = await runtimePreflight({
      env: {
        ...config.env,
        NODE_ENV: 'production',
        UNIFIED_AUTH_PREFLIGHT_CHECK_DB: 'true',
        UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS: 'true'
      },
      cwd: config.backendRoot
    });
  } catch (error) {
    const safeIssues = Array.isArray(error?.issues)
      ? error.issues.map((item) => issue(
        /^[A-Z0-9_]{1,96}$/.test(item?.code || '') ? item.code : 'RUNTIME_PREFLIGHT_FAILED',
        '配置、数据库或 Redis 只读检查失败'
      ))
      : [issue('RUNTIME_PREFLIGHT_FAILED', '配置、数据库或 Redis 只读检查失败')];
    throw buildReleaseFailure(safeIssues);
  }

  if (
    runtimeResult?.ok !== true ||
    runtimeResult.redisChecked !== true ||
    runtimeResult.databaseSchemaChecked !== true ||
    runtimeResult.employeeIndexChecked !== true ||
    runtimeResult.payrollSchemaChecked !== true
  ) {
    throw buildReleaseFailure([
      issue('RUNTIME_PREFLIGHT_INCOMPLETE', '生产配置、数据库和 Redis 必须全部完成只读检查')
    ]);
  }

  return {
    ok: true,
    commit: repository.actualCommit,
    nginxCandidate: config.nginxCandidateRelative,
    backupDiskFreeBytes: disk.freeBytes,
    requiredCommands: REQUIRED_COMMANDS.map(([command]) => command),
    runtime: {
      redisChecked: true,
      databaseSchemaChecked: true,
      payrollSchemaChecked: runtimeResult.payrollSchemaChecked === true
    },
    warnings: runtimeResult.warnings || []
  };
}

module.exports = {
  DEFAULT_MIN_FREE_BYTES,
  MIN_FREE_BYTES,
  MAX_FREE_BYTES,
  MAX_NGINX_CANDIDATE_BYTES,
  REQUIRED_COMMANDS,
  ReleasePrecheckError,
  parseMinFreeBytes,
  isPathInside,
  loadReleasePrecheckConfig,
  defaultCommandRunner,
  validateNginxCandidateSource,
  readNginxCandidate,
  freeBytesFromStatfs,
  checkDiskSpace,
  checkRepository,
  checkRequiredCommands,
  checkDockerRestorePrerequisites,
  runReleasePrecheck
};
