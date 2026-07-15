const fs = require('fs');
const path = require('path');

const mockMainUserScope = jest.fn();
const mockMainUserFindByPk = jest.fn();
const mockEmployeeFindOne = jest.fn();

jest.mock('../src/models/MainUser', () => ({
  scope: mockMainUserScope,
  findByPk: mockMainUserFindByPk
}));

jest.mock('../src/models', () => ({
  Contract: {},
  Payment: {},
  Customer: {},
  Supplier: {},
  BankAccount: {},
  Employee: {
    findOne: mockEmployeeFindOne,
    create: jest.fn()
  }
}));

const authService = require('../src/services/authService');
const { resolveVerificationSecret } = require('../src/middlewares/auth');
const { shouldConnectMainDatabase } = require('../src/config/authFeatures');
const { connectRequiredDatabases } = require('../src/config/startupDatabases');
const wechatSyncService = require('../src/services/wechat/wechatSyncService');

describe('生产全量 SSO 主项目数据库隔离', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_PASSWORD_LOGIN = 'false';
    process.env.ENABLE_LEGACY_SESSION = 'false';
    process.env.ENABLE_SSO_LOGIN = 'true';
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.ERP_SESSION_SECRET = 'erp-session-secret';
    delete process.env.JWT_SECRET;
    delete process.env.MAIN_DB_HOST;
    delete process.env.MAIN_DB_NAME;
    delete process.env.MAIN_DB_USER;
    delete process.env.MAIN_DB_PASSWORD;
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('全量 SSO 启动只连接 ERP 数据库，不加载主库连接器', async () => {
    const connectErpDatabase = jest.fn().mockResolvedValue(undefined);
    const connectLegacyMainDatabase = jest.fn().mockResolvedValue(true);

    expect(shouldConnectMainDatabase()).toBe(false);
    await expect(connectRequiredDatabases({
      connectErpDatabase,
      connectLegacyMainDatabase
    })).resolves.toEqual({
      mainDatabaseRequired: false,
      mainDatabaseConnected: false
    });

    expect(connectErpDatabase).toHaveBeenCalledTimes(1);
    expect(connectLegacyMainDatabase).not.toHaveBeenCalled();
  });

  test('只有 legacy 会话开启时才连接主项目数据库', async () => {
    process.env.ENABLE_PASSWORD_LOGIN = 'true';
    process.env.ENABLE_LEGACY_SESSION = 'true';
    const connectErpDatabase = jest.fn().mockResolvedValue(undefined);
    const connectLegacyMainDatabase = jest.fn().mockResolvedValue(true);

    expect(shouldConnectMainDatabase()).toBe(true);
    await expect(connectRequiredDatabases({
      connectErpDatabase,
      connectLegacyMainDatabase
    })).resolves.toEqual({
      mainDatabaseRequired: true,
      mainDatabaseConnected: true
    });
    expect(connectLegacyMainDatabase).toHaveBeenCalledTimes(1);
  });

  test('错误组合 password=true、legacy=false 仍拒绝旧登录且不查询 MainUser', async () => {
    process.env.ENABLE_PASSWORD_LOGIN = 'true';
    process.env.ENABLE_LEGACY_SESSION = 'false';

    expect(shouldConnectMainDatabase()).toBe(false);
    await expect(authService.login('legacy-user', 'secret')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });
    expect(mockMainUserScope).not.toHaveBeenCalled();
  });

  test('legacy 关闭后 profile、验签和签发均在接触 MainUser/JWT_SECRET 前失败', async () => {
    await expect(authService.getProfile(7)).rejects.toMatchObject({ statusCode: 401 });
    expect(() => authService.verifyToken('legacy-token')).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
    expect(() => authService.generateToken({ id: 7, username: 'old', role: 'admin' })).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => resolveVerificationSecret(false)).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
    expect(resolveVerificationSecret(true)).toBe('erp-session-secret');
    expect(mockMainUserScope).not.toHaveBeenCalled();
    expect(mockMainUserFindByPk).not.toHaveBeenCalled();
  });

  test('操作日志、企微同步和业务模型注册中心不再引用主项目 users/MainUser', () => {
    const read = (relativePath) => fs.readFileSync(
      path.join(__dirname, '..', relativePath),
      'utf8'
    );
    const logsSource = read('src/routes/logs.js');
    const wechatSource = read('src/services/wechat/wechatSyncService.js');
    const modelsSource = read('src/models/index.js');

    expect(logsSource).not.toMatch(/MAIN_DB|patent_notice_system|JOIN\s+.*users/i);
    expect(logsSource).toMatch(/FROM employees e/);
    expect(wechatSource).not.toMatch(/MainUser|models\/MainUser/);
    expect(modelsSource).not.toMatch(/require\(['"]\.\/MainUser['"]\)|mainSequelize/);
  });

  test('企微申请人只按 employees.wechat_userid 显式绑定 users.id', async () => {
    mockEmployeeFindOne.mockResolvedValueOnce({ user_id: 27 });
    await expect(wechatSyncService._resolveUserId('zhangsan')).resolves.toBe(27);
    expect(mockEmployeeFindOne).toHaveBeenCalledWith({
      where: { wechat_userid: 'zhangsan' },
      attributes: ['user_id']
    });

    mockEmployeeFindOne.mockResolvedValueOnce({ user_id: null });
    await expect(wechatSyncService._resolveUserId('unbound-user')).resolves.toBeNull();
  });
});
