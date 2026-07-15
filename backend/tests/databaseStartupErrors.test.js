'use strict';

const { connectDatabase } = require('../src/config/database');
const { connectMainDatabase } = require('../src/config/mainDatabase');
const { connectRequiredDatabases } = require('../src/config/startupDatabases');

describe('数据库启动连接器错误语义', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('ERP 数据库连接失败时抛安全错误，不直接退出进程', async () => {
    const database = {
      authenticate: jest.fn().mockRejectedValue(new Error('password=secret'))
    };
    const employeeIndexCheck = jest.fn();
    const wechatIndexCheck = jest.fn();
    const performanceIndexCheck = jest.fn();
    const payrollSchemaCheck = jest.fn();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

    await expect(connectDatabase({
      database,
      employeeIndexCheck,
      wechatIndexCheck,
      performanceIndexCheck,
      payrollSchemaCheck
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ERP_DATABASE_UNAVAILABLE',
      message: 'ERP 数据库无法连接'
    });

    expect(employeeIndexCheck).not.toHaveBeenCalled();
    expect(wechatIndexCheck).not.toHaveBeenCalled();
    expect(performanceIndexCheck).not.toHaveBeenCalled();
    expect(payrollSchemaCheck).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  test('ERP 数据库结构门禁失败时使用独立安全错误码', async () => {
    const database = { authenticate: jest.fn().mockResolvedValue(true) };

    await expect(connectDatabase({
      database,
      employeeIndexCheck: jest.fn().mockRejectedValue(new Error('raw schema detail')),
      wechatIndexCheck: jest.fn(),
      performanceIndexCheck: jest.fn()
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ERP_DATABASE_SCHEMA_INVALID',
      message: 'ERP 数据库结构未满足启动要求'
    });
  });

  test('薪酬结构门禁失败时拒绝启动且不泄露原始结构详情', async () => {
    const database = { authenticate: jest.fn().mockResolvedValue(true) };

    await expect(connectDatabase({
      database,
      employeeIndexCheck: jest.fn().mockResolvedValue(true),
      wechatIndexCheck: jest.fn().mockResolvedValue(true),
      performanceIndexCheck: jest.fn().mockResolvedValue(true),
      payrollSchemaCheck: jest.fn().mockRejectedValue(
        new Error('ALTER TABLE payrolls secret_detail')
      )
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ERP_DATABASE_SCHEMA_INVALID',
      message: 'ERP 数据库结构未满足启动要求'
    });
  });

  test('legacy 主项目数据库连接失败时不再静默降级', async () => {
    await expect(connectMainDatabase({
      database: { authenticate: jest.fn().mockRejectedValue(new Error('access denied')) }
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'LEGACY_MAIN_DATABASE_UNAVAILABLE'
    });
  });

  test('legacy 开启时 connector 返回 false 也视为启动失败', async () => {
    process.env.ENABLE_LEGACY_SESSION = 'true';
    process.env.ENABLE_PASSWORD_LOGIN = 'true';

    await expect(connectRequiredDatabases({
      connectErpDatabase: jest.fn().mockResolvedValue(true),
      connectLegacyMainDatabase: jest.fn().mockResolvedValue(false)
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'LEGACY_MAIN_DATABASE_UNAVAILABLE'
    });
  });

  test('注入连接器抛普通异常时 startupDatabases 收敛为安全错误码', async () => {
    await expect(connectRequiredDatabases({
      connectErpDatabase: jest.fn().mockRejectedValue(new Error('mysql://user:secret@host'))
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ERP_DATABASE_STARTUP_FAILED'
    });
  });
});
