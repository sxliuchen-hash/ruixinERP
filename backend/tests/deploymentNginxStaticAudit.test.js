const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
}

function extractLocation(source, locationPattern) {
  const startMatch = source.match(locationPattern);
  if (!startMatch || startMatch.index === undefined) return '';

  const start = startMatch.index;
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) return '';

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function extractServer(source, listenPattern) {
  let cursor = 0;
  while (cursor < source.length) {
    const remainder = source.slice(cursor);
    const startMatch = remainder.match(/server\s*\{/);
    if (!startMatch || startMatch.index === undefined) return '';

    const start = cursor + startMatch.index;
    const serverBlock = extractLocation(source.slice(start), /^server\s*\{/);
    if (!serverBlock) return '';
    if (listenPattern.test(serverBlock)) return serverBlock;
    cursor = start + serverBlock.length;
  }
  return '';
}

describe('生产 Nginx 与 SSO 边缘部署静态门禁', () => {
  const nginxSource = readRepoFile('deploy', 'nginx.conf');
  const httpServerSource = extractServer(nginxSource, /listen\s+80;/);
  const httpsServerSource = extractServer(nginxSource, /listen\s+443\s+ssl/);

  test('SPA history fallback 支持直接打开 /sso/initiate 和 /sso/callback', () => {
    const rootLocation = extractLocation(httpsServerSource, /location\s+\/\s*\{/);
    const callbackLocation = extractLocation(
      httpsServerSource,
      /location\s*=\s*\/sso\/callback\s*\{/
    );

    expect(rootLocation).toContain('try_files $uri $uri/ /index.html;');
    expect(callbackLocation).toContain('try_files $uri $uri/ /index.html;');
  });

  test('/api/ 必须反向代理到 ERP 后端并保留代理上下文', () => {
    const apiLocation = extractLocation(httpsServerSource, /location\s+\/api\/\s*\{/);

    expect(apiLocation).toContain('proxy_pass http://127.0.0.1:3001;');
    expect(apiLocation).toContain('proxy_set_header Host $host;');
    expect(apiLocation).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(apiLocation).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
  });

  test('Nginx 隐藏版本、收敛连接类 502/504，并透传后端业务 503', () => {
    const apiLocation = extractLocation(httpsServerSource, /location\s+\/api\/\s*\{/);
    const upstreamErrorLocation = extractLocation(
      httpsServerSource,
      /location\s+@api_upstream_unavailable\s*\{/
    );

    expect(nginxSource).toMatch(/server_tokens\s+off;/);
    expect(apiLocation).toContain('proxy_intercept_errors on;');
    expect(apiLocation).toMatch(
      /error_page\s+502\s+504\s+=\s+@api_upstream_unavailable;/
    );
    expect(apiLocation).not.toMatch(/error_page[^;]*503/);
    expect(upstreamErrorLocation).toContain('internal;');
    expect(upstreamErrorLocation).toContain('default_type application/json;');
    expect(upstreamErrorLocation).toContain('add_header Cache-Control "no-store" always;');
    expect(upstreamErrorLocation).toMatch(/return\s+503\s+'\{.*"success":false.*\}';/);
    expect(upstreamErrorLocation).not.toMatch(/nginx\/?[0-9]/i);
  });

  test('SSO callback 禁止缓存并禁止 Referer 泄漏一次性 Code', () => {
    const callbackLocation = extractLocation(
      httpsServerSource,
      /location\s*=\s*\/sso\/callback\s*\{/
    );

    expect(callbackLocation).toMatch(/Cache-Control\s+"[^"]*no-store[^"]*"\s+always;/);
    expect(callbackLocation).toContain('add_header Pragma "no-cache" always;');
    expect(callbackLocation).toContain('add_header Expires "0" always;');
    expect(callbackLocation).toContain('add_header Referrer-Policy "no-referrer" always;');
    expect(callbackLocation).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    expect(callbackLocation).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(callbackLocation).toMatch(
      /Strict-Transport-Security\s+"[^"]*max-age=31536000[^"]*"\s+always;/
    );
  });

  test('SSO callback 不得把查询串中的一次性 Code 写入 Nginx access log', () => {
    const callbackLocation = extractLocation(
      httpsServerSource,
      /location\s*=\s*\/sso\/callback\s*\{/
    );

    // Nginx 默认 combined 日志包含 `$request`，会记录完整 `?code=...`。
    // callback 必须关闭 access log，或后续改为明确剔除 `$args` 的专用日志格式。
    expect(callbackLocation).toContain('access_log off;');
  });

  test('HTTP callback 直接拒绝且不把 Code/state 复制到 HTTPS Location', () => {
    const httpCallbackLocation = extractLocation(
      httpServerSource,
      /location\s*=\s*\/sso\/callback\s*\{/
    );
    const httpRootLocation = extractLocation(httpServerSource, /location\s+\/\s*\{/);

    expect(httpServerSource).toContain('access_log off;');
    expect(httpCallbackLocation).toContain('default_type application/json;');
    expect(httpCallbackLocation).toContain('add_header Cache-Control "no-store" always;');
    expect(httpCallbackLocation).toMatch(/return\s+400\s+'\{.*"code":"HTTPS_REQUIRED".*\}';/);
    expect(httpCallbackLocation).not.toContain('return 301');
    expect(httpCallbackLocation).not.toContain('$request_uri');
    expect(httpRootLocation).toContain('return 301 https://$server_name$request_uri;');
  });

  test('部署手册不得传播旧共享密钥，并明确 ERP 独立会话密钥', () => {
    const deploymentGuide = readRepoFile('docs', '部署运维手册.md');
    const legacySharedSecret = [
      'patent_notice_system', 'jwt_secret', '2024', 'production_key'
    ].join('_');

    expect(deploymentGuide).not.toContain(legacySharedSecret);
    expect(deploymentGuide).toContain('ERP_SESSION_SECRET=<使用密码管理器生成的高强度独立随机值>');
    expect(deploymentGuide).toContain('Referrer-Policy: no-referrer');
    expect(deploymentGuide).toContain('try_files $uri $uri/ /index.html;');
    expect(deploymentGuide).toContain('bash /var/www/erp/backend/scripts/deploy.sh');
    expect(deploymentGuide).toContain('bash /var/www/erp/deploy/deploy.sh');
    expect(deploymentGuide).toContain('fail-closed 拒绝桩');
    expect(deploymentGuide).toContain('状态码 `78`');
  });

  test.each([
    ['宝塔历史入口', ['backend', 'scripts', 'deploy.sh']],
    ['仓库 Nginx 模板历史入口', ['deploy', 'deploy.sh']]
  ])('%s 必须保持纯 fail-closed 拒绝桩', (_name, segments) => {
    const deployScript = readRepoFile(...segments).replace(/\r\n/g, '\n');

    expect(deployScript).toContain('历史一键部署入口已禁用（fail-closed）');
    expect(deployScript).toContain('docs/部署运维手册.md');
    expect(deployScript).toMatch(/\nexit 78\n?$/);
    expect(deployScript).not.toMatch(
      /\b(?:git|npm|mysql|pm2|nginx|systemctl|curl|sudo|ALTER|CREATE|DROP)\b/i
    );
  });
});
