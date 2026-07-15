const {
  readBooleanEnv,
  isSsoLoginEnabled,
  isPasswordLoginEnabled,
  isLegacySessionEnabled,
  getAuthFeatures
} = require('../src/config/authFeatures');
const authController = require('../src/controllers/authController');
const authRouter = require('../src/routes/auth');
const fs = require('fs');
const path = require('path');

describe('认证 feature flags', () => {
  const originalSso = process.env.ENABLE_SSO_LOGIN;
  const originalPassword = process.env.ENABLE_PASSWORD_LOGIN;
  const originalLegacySession = process.env.ENABLE_LEGACY_SESSION;
  const originalMainSystemUrl = process.env.MAIN_SYSTEM_URL;

  afterEach(() => {
    if (originalSso === undefined) delete process.env.ENABLE_SSO_LOGIN;
    else process.env.ENABLE_SSO_LOGIN = originalSso;

    if (originalPassword === undefined) delete process.env.ENABLE_PASSWORD_LOGIN;
    else process.env.ENABLE_PASSWORD_LOGIN = originalPassword;

    if (originalLegacySession === undefined) delete process.env.ENABLE_LEGACY_SESSION;
    else process.env.ENABLE_LEGACY_SESSION = originalLegacySession;

    if (originalMainSystemUrl === undefined) delete process.env.MAIN_SYSTEM_URL;
    else process.env.MAIN_SYSTEM_URL = originalMainSystemUrl;
  });

  test('未配置时 SSO 默认关闭、旧密码登录默认开启', () => {
    delete process.env.ENABLE_SSO_LOGIN;
    delete process.env.ENABLE_PASSWORD_LOGIN;
    delete process.env.ENABLE_LEGACY_SESSION;

    expect(isSsoLoginEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(true);
    expect(isLegacySessionEnabled()).toBe(true);
  });

  test.each(['1', 'true', 'TRUE', 'yes', 'on'])('ENABLE_SSO_LOGIN=%s 可显式开启', (value) => {
    process.env.ENABLE_SSO_LOGIN = value;
    expect(isSsoLoginEnabled()).toBe(true);
  });

  test.each(['0', 'false', 'FALSE', 'no', 'off'])('ENABLE_PASSWORD_LOGIN=%s 可显式关闭', (value) => {
    process.env.ENABLE_PASSWORD_LOGIN = value;
    expect(isPasswordLoginEnabled()).toBe(false);
  });

  test('非法 feature flag 值使用安全默认值', () => {
    process.env.ENABLE_SSO_LOGIN = 'invalid';
    process.env.ENABLE_PASSWORD_LOGIN = 'invalid';

    expect(isSsoLoginEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(true);
    expect(readBooleanEnv('MISSING_TEST_FLAG', false)).toBe(false);
  });

  test('每次调用动态读取环境变量，部署更新无需模块重载', () => {
    process.env.ENABLE_SSO_LOGIN = 'false';
    expect(isSsoLoginEnabled()).toBe(false);

    process.env.ENABLE_SSO_LOGIN = 'true';
    expect(isSsoLoginEnabled()).toBe(true);

    process.env.ENABLE_PASSWORD_LOGIN = 'true';
    expect(isPasswordLoginEnabled()).toBe(true);

    process.env.ENABLE_PASSWORD_LOGIN = 'false';
    expect(isPasswordLoginEnabled()).toBe(false);

    process.env.ENABLE_LEGACY_SESSION = 'true';
    expect(isLegacySessionEnabled()).toBe(true);
    process.env.ENABLE_LEGACY_SESSION = 'false';
    expect(isLegacySessionEnabled()).toBe(false);
  });

  test('公开 feature snapshot 只返回开关和固定主项目地址', () => {
    process.env.ENABLE_SSO_LOGIN = 'true';
    process.env.ENABLE_PASSWORD_LOGIN = 'false';
    process.env.MAIN_SYSTEM_URL = 'https://iptt.top';

    expect(getAuthFeatures()).toEqual({
      passwordLoginEnabled: false,
      ssoLoginEnabled: true,
      mainSystemUrl: 'https://iptt.top/'
    });

    const res = { json: jest.fn() };
    authController.features({}, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        passwordLoginEnabled: false,
        ssoLoginEnabled: true,
        mainSystemUrl: 'https://iptt.top/'
      }
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/secret|client/i);
  });

  test('GET /auth/features 无需登录即可读取', () => {
    const route = authRouter.stack.find((layer) => layer.route?.path === '/features');
    expect(route).toBeDefined();
    expect(route.route.methods).toMatchObject({ get: true });
  });

  test('登录页以公开 feature snapshot 控制密码表单和主项目入口', () => {
    const loginSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'views', 'Login.vue'),
      'utf8'
    );
    const authApiSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'auth.js'),
      'utf8'
    );

    expect(authApiSource).toContain("request.get('/auth/features')");
    expect(loginSource).toContain("import { getAuthFeatures } from '@/api/auth'");
    expect(loginSource).toMatch(/async function loadAuthFeatures\(\)[\s\S]*?await getAuthFeatures\(\)/);
    expect(loginSource).toContain('onMounted(loadAuthFeatures)');
    expect(loginSource).toContain('v-if="featuresLoaded && passwordLoginEnabled"');
    expect(loginSource).toContain('v-if="showMainSystemButton"');
    expect(loginSource).toContain('features.passwordLoginEnabled === true');
    expect(loginSource).toContain('features.ssoLoginEnabled === true');
    expect(loginSource).toContain('const passwordLoginEnabled = ref(false)');
    expect(loginSource).toMatch(/catch \{[\s\S]*?passwordLoginEnabled\.value = false/);
    expect(loginSource).toContain("path: '/sso/initiate'");
    expect(loginSource).toContain('assignExternalHttpUrl(mainSystemUrl.value)');
    expect(loginSource).not.toContain('window.location.assign(mainSystemUrl.value)');
  });

  test('非法 MAIN_SYSTEM_URL 不暴露到登录页', () => {
    process.env.MAIN_SYSTEM_URL = 'javascript:alert(1)';
    expect(getAuthFeatures().mainSystemUrl).toBe('');
  });

  test('legacy session 关闭时公开 feature 不得继续宣称密码登录可用', () => {
    process.env.ENABLE_PASSWORD_LOGIN = 'true';
    process.env.ENABLE_LEGACY_SESSION = 'false';

    expect(isPasswordLoginEnabled()).toBe(true);
    expect(getAuthFeatures().passwordLoginEnabled).toBe(false);
  });

  test('部署示例显式记录灰度、下线和回滚开关', () => {
    const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

    expect(envExample).toMatch(/^ENABLE_SSO_LOGIN=false$/m);
    expect(envExample).toMatch(/^ENABLE_PASSWORD_LOGIN=true$/m);
    expect(envExample).toMatch(/^ENABLE_LEGACY_SESSION=true$/m);
    expect(envExample).toMatch(/^ERP_SSO_ALLOW_LEGACY_NO_KID=false$/m);
  });
});
