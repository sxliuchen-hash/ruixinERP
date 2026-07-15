'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
}

describe('release precheck 与 ready wait 交付安全门禁', () => {
  const releaseScript = readRepoFile('backend', 'scripts', 'run-release-precheck.js');
  const releaseService = readRepoFile('backend', 'src', 'services', 'releasePrecheckService.js');
  const readyScript = readRepoFile('backend', 'scripts', 'wait-for-ready.js');
  const readyService = readRepoFile('backend', 'src', 'services', 'readyWaitService.js');
  const packageJson = JSON.parse(readRepoFile('backend', 'package.json'));
  const ci = readRepoFile('.github', 'workflows', 'ci.yml');
  const deploymentGuide = readRepoFile('docs', '部署运维手册.md');

  test('release precheck 源码不包含发布写操作、DDL、进程或流量切换命令', () => {
    const source = `${releaseScript}\n${releaseService}`;
    const forbidden = [
      /git\s+(?:pull|fetch|checkout|switch|merge|reset|clean)\b/i,
      /pm2\s+(?:start|stop|restart|reload|delete|startOrRestart)\b/i,
      /nginx\s+-s\s+reload\b/i,
      /systemctl\s+(?:start|stop|restart|reload)\b/i,
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|DATABASE|INTO|FROM|[A-Za-z_])/i,
      /\bfs\.(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|rm|rmSync|unlink|unlinkSync|mkdir|mkdirSync)\b/,
      /\b(?:exec|execSync)\s*\(/
    ];
    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    expect(releaseService).toContain("['git', ['--version']]");
    expect(releaseService).toContain("['status', '--porcelain=v1', '--untracked-files=all']");
    expect(releaseService).toContain("['ls-files', '--error-unmatch', '--', config.nginxCandidateRelative]");
  });

  test('ready wait 只发固定无凭证 GET，拒绝 query、userinfo、redirect 和任意路径', () => {
    const source = `${readyScript}\n${readyService}`;
    expect(readyService).toContain("const READY_PATH = '/api/v1/health/ready';");
    expect(readyService).toContain("redirect: 'error'");
    expect(readyService).toContain("method: 'GET'");
    expect(readyService).toContain('READY_URL_CREDENTIALS_FORBIDDEN');
    expect(readyService).toContain('READY_URL_QUERY_FORBIDDEN');
    expect(readyService).toContain('READY_URL_HOST_NOT_ALLOWED');
    expect(source).not.toMatch(/['"]Authorization['"]\s*:/i);
    expect(source).not.toMatch(/['"]Cookie['"]\s*:/i);
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  });

  test('package 与 CI 把两个工具及其功能/安全测试纳入固定交付契约', () => {
    expect(packageJson.scripts['precheck:release']).toBe('node scripts/run-release-precheck.js');
    expect(packageJson.scripts['wait:ready']).toBe('node scripts/wait-for-ready.js');
    expect(packageJson.scripts['test:delivery-safety']).toContain('tests/releaseToolingSafety.test.js');
    expect(packageJson.scripts['test:delivery-safety']).toContain('tests/releasePrecheck.test.js');
    expect(packageJson.scripts['test:delivery-safety']).toContain('tests/waitForReady.test.js');
    expect(ci).toContain('node --check backend/scripts/run-release-precheck.js');
    expect(ci).toContain('node --check backend/scripts/wait-for-ready.js');
  });

  test('运维手册把 precheck 放在停写前，并用有界 wait 工具替代开放式 curl 循环', () => {
    const precheckIndex = deploymentGuide.indexOf('npm run precheck:release');
    const stopIndex = deploymentGuide.indexOf('pm2 stop erp-backend', precheckIndex);
    expect(precheckIndex).toBeGreaterThan(0);
    expect(stopIndex).toBeGreaterThan(precheckIndex);
    expect(deploymentGuide).toContain('DB_RESTORE_MYSQL_IMAGE');
    expect(deploymentGuide).toContain('npm run wait:ready');
    expect(deploymentGuide).toContain('READY_ALLOWED_HOSTS=erp.iptt.top');
    expect(deploymentGuide).not.toContain(
      'until curl -fsS http://127.0.0.1:3001/api/v1/health/ready'
    );
  });
});
