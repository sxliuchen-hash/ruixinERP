'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function readFrontend(...segments) {
  return fs.readFileSync(path.join(FRONTEND_SRC, ...segments), 'utf8');
}

describe('ERP RP 发起 state 前端契约验收', () => {
  test('Router 同时公开固定 initiate 与 callback 页面', () => {
    const source = readFrontend('router', 'index.js');

    expect(source).toContain("path: '/sso/initiate'");
    expect(source).toContain("path: '/sso/callback'");
    expect(source).toContain("to.path === '/sso/initiate' || to.path === '/sso/callback'");
  });

  test('initiate state 只由 ERP 后端创建并通过 HttpOnly Cookie 绑定', () => {
    const apiSource = readFrontend('api', 'auth.js');
    const viewSource = readFrontend('views', 'SsoInitiate.vue');

    expect(apiSource).toContain("request.post('/auth/sso/initiate', data, { withCredentials: true })");
    expect(viewSource).toContain('const response = await initiateSso(');
    expect(viewSource).toContain('const state = response.data?.state');
    expect(viewSource).toContain('/^[A-Za-z0-9_-]{32,200}$/');
    expect(viewSource).toContain('normalizeContinueUrl(response.data?.redirectUrl, state)');
    expect(viewSource).toContain('import.meta.env.VITE_MAIN_SYSTEM_URL');
    expect(viewSource).toContain(
      'normalizeExternalHttpUrl(import.meta.env.VITE_MAIN_SYSTEM_URL)'
    );
    expect(viewSource).not.toMatch(
      /normalizeExternalHttpUrl\(\s*import\.meta\.env\.VITE_MAIN_SYSTEM_URL\s*,/
    );
    expect(viewSource).toContain("const mainSystemOrigin = mainSystemUrl ? new URL(mainSystemUrl).origin : ''");
    expect(viewSource).toContain("if (!mainSystemOrigin) return ''");
    expect(viewSource).toContain("if (!['http:', 'https:'].includes(url.protocol)) return ''");
    expect(viewSource).toContain("if (url.username || url.password || url.hash) return ''");
    expect(viewSource).toContain("if (url.origin !== mainSystemOrigin) return ''");
    expect(viewSource).toContain("if (url.pathname !== '/sso/continue') return ''");
    expect(viewSource).toContain("url.searchParams.getAll('app').length !== 1");
    expect(viewSource).toContain("url.searchParams.get('app') !== 'erp'");
    expect(viewSource).toContain("url.searchParams.getAll('state').length !== 1");
    expect(viewSource).toContain("url.searchParams.get('state') !== expectedState");
    expect(viewSource).toContain("queryKeys.length !== 2 || queryKeys[0] !== 'app' || queryKeys[1] !== 'state'");
    expect(viewSource).toContain('window.location.assign(redirectUrl)');

    expect(viewSource).not.toMatch(/crypto\.(?:randomUUID|getRandomValues)/);
    expect(viewSource).not.toMatch(/(?:localStorage|sessionStorage)\.(?:setItem|getItem)[^\n]*state/i);
    expect(viewSource).not.toContain('/api/v1/sso/erp/authorize');
    expect(viewSource).not.toContain("new URL('/sso/continue'");
  });

  test('本地和生产构建均提供显式主项目 Origin 配置入口', () => {
    const localTemplate = fs.readFileSync(path.join(REPO_ROOT, 'frontend', '.env.example'), 'utf8');
    const productionTemplate = fs.readFileSync(
      path.join(REPO_ROOT, 'frontend', '.env.production.example'),
      'utf8'
    );
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, 'frontend', '.gitignore'), 'utf8');
    const ciWorkflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(localTemplate).toMatch(/^VITE_MAIN_SYSTEM_URL=https?:\/\/[^\s/]+/m);
    expect(productionTemplate).toMatch(/^VITE_MAIN_SYSTEM_URL=https:\/\/[^\s/]+/m);
    expect(gitignore).toMatch(/^\.env\.production$/m);
    expect(gitignore).toMatch(/^!\.env\.production\.example$/m);
    expect(ciWorkflow).toContain('VITE_MAIN_SYSTEM_URL: https://main-ci.test');
  });

  test('production build 在主项目 Origin 缺失、非法或为占位值时 fail-closed', () => {
    const viteConfig = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'vite.config.js'), 'utf8');

    expect(viteConfig).toContain("loadEnv(mode, process.cwd(), 'VITE_')");
    expect(viteConfig).toContain("if (mode === 'production')");
    expect(viteConfig).toContain('process.env.VITE_MAIN_SYSTEM_URL || env.VITE_MAIN_SYSTEM_URL');
    expect(viteConfig).toContain("throw new Error('生产构建缺少 VITE_MAIN_SYSTEM_URL')");
    expect(viteConfig).toContain("if (url.pathname !== '/') throw new Error('path')");
    expect(viteConfig).toContain('placeholderHost.test(url.hostname)');
  });

  test('callback 读取 code+state 后在网络兑换前清除 URL/history', () => {
    const source = readFrontend('views', 'SsoCallback.vue');
    const codeRead = source.indexOf('const code =');
    const stateRead = source.indexOf('const state =');
    const routerCleanup = source.indexOf("await router.replace({ path: '/sso/callback' })");
    const historyCleanup = source.indexOf("window.history.replaceState(window.history.state, '', '/sso/callback')");
    const missingState = source.indexOf('if (!state)');
    const exchange = source.indexOf('await userStore.exchangeSsoCode(code, state)');

    expect(codeRead).toBeGreaterThan(-1);
    expect(stateRead).toBeGreaterThan(codeRead);
    expect(source).toContain('/^[A-Za-z0-9_-]{32,200}$/');
    expect(routerCleanup).toBeGreaterThan(stateRead);
    expect(historyCleanup).toBeGreaterThan(routerCleanup);
    expect(missingState).toBeGreaterThan(routerCleanup);
    expect(exchange).toBeGreaterThan(missingState);
    expect(source).not.toMatch(/route\.query\.redirect/);
  });

  test('浏览器兑换请求显式携带 state、Cookie 且拒绝无 state 调用', () => {
    const apiSource = readFrontend('api', 'auth.js');
    const storeSource = readFrontend('stores', 'user.js');

    expect(apiSource).toContain('export function exchangeSsoCode(code, state)');
    expect(apiSource).toContain("request.post('/auth/sso/exchange', { code, state }, { withCredentials: true })");
    expect(apiSource).not.toMatch(/request\.get\([^\n]*sso\/exchange/);
    expect(storeSource).toContain("if (!state) throw new Error('SSO 回调缺少 state')");
    expect(storeSource).toContain('exchangeSsoCodeApi(code, state)');
  });

  test('code/state 不落入 Web Storage 或长期会话元数据', () => {
    const sources = [
      readFrontend('views', 'SsoInitiate.vue'),
      readFrontend('views', 'SsoCallback.vue'),
      readFrontend('api', 'auth.js'),
      readFrontend('stores', 'user.js')
    ].join('\n');

    expect(sources).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:authorizationCode|sso[_-]?code|sso[_-]?state)/i);
    expect(sources).not.toMatch(/STORAGE_KEYS[\s\S]{0,300}(?:code|state)\s*:/i);
  });
});
