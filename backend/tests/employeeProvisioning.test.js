const internalRouter = require('../src/routes/internal');
const {
  requireProvisionClient,
  requireIdempotencyKey
} = require('../src/middlewares/internalServiceAuth');
const { provisionEmployeeSchema } = require('../src/validators/internalProvisioning');
const {
  EmployeeProvisioningService
} = require('../src/services/employeeProvisioningService');

describe('主项目 Employee 幂等建档', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('内部路由注册独立 provisioning endpoint', () => {
    const route = internalRouter.stack.find(
      (layer) => layer.route?.path === '/provisioning/employees'
    );
    expect(route).toBeDefined();
    expect(route.route.methods).toMatchObject({ post: true });
  });

  test('建档服务凭证未配置时 fail-closed 为 503', () => {
    delete process.env.ERP_PROVISION_CLIENT_ID;
    delete process.env.ERP_PROVISION_CLIENT_SECRET;
    const next = jest.fn();

    requireProvisionClient({ headers: {} }, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 503,
      code: 'PROVISION_API_CONFIGURATION_ERROR'
    });
  });

  test('错误建档凭证返回 401，正确凭证通过', () => {
    process.env.ERP_PROVISION_CLIENT_ID = 'main-provision';
    process.env.ERP_PROVISION_CLIENT_SECRET = 'provision-secret';

    const denied = jest.fn();
    requireProvisionClient({
      headers: {
        'x-main-provision-client-id': 'main-provision',
        'x-main-provision-client-secret': 'wrong'
      }
    }, {}, denied);
    expect(denied.mock.calls[0][0]).toMatchObject({ statusCode: 401 });

    const allowed = jest.fn();
    requireProvisionClient({
      headers: {
        'x-main-provision-client-id': 'main-provision',
        'x-main-provision-client-secret': 'provision-secret'
      }
    }, {}, allowed);
    expect(allowed).toHaveBeenCalledWith();
  });

  test('Idempotency-Key 必填且只保存规范化值', () => {
    const missingNext = jest.fn();
    requireIdempotencyKey({ headers: {} }, {}, missingNext);
    expect(missingNext.mock.calls[0][0]).toMatchObject({ statusCode: 400 });

    const req = {
      headers: {},
      get: jest.fn().mockReturnValue('  binding-attempt-123  ')
    };
    const next = jest.fn();
    requireIdempotencyKey(req, {}, next);
    expect(req.idempotencyKey).toBe('binding-attempt-123');
    expect(next).toHaveBeenCalledWith();
  });

  test.each([
    [{ userId: 0, name: '张三', employeeRole: 'sales' }],
    [{ userId: 1, name: '', employeeRole: 'sales' }],
    [{ userId: 1, name: '张三', employeeRole: 'unknown' }]
  ])('非法建档请求被拒绝：%p', (payload) => {
    expect(provisionEmployeeSchema.validate(payload).error).toBeDefined();
  });

  test('首次请求按 user_id 创建 Employee', async () => {
    const employee = {
      id: 18,
      user_id: 42,
      name: '张三',
      role: 'sales',
      wechat_userid: null,
      update: jest.fn()
    };
    const model = {
      findOrCreate: jest.fn().mockResolvedValue([employee, true])
    };
    const service = new EmployeeProvisioningService({ model });

    const result = await service.provision({
      userId: 42,
      name: '张三',
      employeeRole: 'sales',
      wechatUserId: null,
      idempotencyKey: 'attempt-42'
    });

    expect(model.findOrCreate).toHaveBeenCalledWith({
      where: { user_id: 42 },
      defaults: { user_id: 42, name: '张三', role: 'sales' }
    });
    expect(result).toEqual({ employee, created: true });
    expect(employee.update).not.toHaveBeenCalled();
  });

  test('重复或改岗请求只同步身份字段，不覆盖薪资与职级', async () => {
    const employee = {
      id: 18,
      user_id: 42,
      name: '旧姓名',
      role: 'sales',
      wechat_userid: 'old-wechat',
      grade: 'E',
      base_salary: 9999,
      hire_date: '2020-01-01',
      update: jest.fn().mockResolvedValue(true)
    };
    const model = {
      findOrCreate: jest.fn().mockResolvedValue([employee, false])
    };
    const service = new EmployeeProvisioningService({ model });

    await service.provision({
      userId: 42,
      name: '新姓名',
      employeeRole: 'partner',
      wechatUserId: 'new-wechat',
      idempotencyKey: 'attempt-43'
    });

    expect(employee.update).toHaveBeenCalledWith({
      name: '新姓名',
      role: 'partner',
      wechat_userid: 'new-wechat'
    });
    expect(employee.update.mock.calls[0][0]).not.toHaveProperty('grade');
    expect(employee.update.mock.calls[0][0]).not.toHaveProperty('base_salary');
    expect(employee.update.mock.calls[0][0]).not.toHaveProperty('hire_date');
  });

  test('主项目传 null 企微标识时不清空 ERP 现有绑定', async () => {
    const employee = {
      id: 18,
      user_id: 42,
      name: '张三',
      role: 'sales',
      wechat_userid: 'kept-wechat',
      update: jest.fn()
    };
    const model = {
      findOrCreate: jest.fn().mockResolvedValue([employee, false])
    };
    const service = new EmployeeProvisioningService({ model });

    await service.provision({
      userId: 42,
      name: '张三',
      employeeRole: 'sales',
      wechatUserId: null,
      idempotencyKey: 'attempt-44'
    });

    expect(employee.update).not.toHaveBeenCalled();
  });

  test('相同 Idempotency-Key 和相同载荷的并发请求只执行一次', async () => {
    let resolveCreate;
    const employee = {
      id: 20,
      user_id: 50,
      name: '并发用户',
      role: 'sales',
      update: jest.fn()
    };
    const model = {
      findOrCreate: jest.fn().mockImplementation(() => new Promise((resolve) => {
        resolveCreate = resolve;
      }))
    };
    const service = new EmployeeProvisioningService({ model });
    const payload = {
      userId: 50,
      name: '并发用户',
      employeeRole: 'sales',
      wechatUserId: null,
      idempotencyKey: 'same-attempt-50'
    };

    const first = service.provision(payload);
    const second = service.provision(payload);
    await new Promise((resolve) => setImmediate(resolve));
    expect(model.findOrCreate).toHaveBeenCalledTimes(1);
    resolveCreate([employee, true]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { employee, created: true },
      { employee, created: true }
    ]);
    expect(model.findOrCreate).toHaveBeenCalledTimes(1);
  });

  test('相同 Idempotency-Key 复用不同载荷返回 409 且不修改 Employee', async () => {
    const employee = {
      id: 21,
      user_id: 51,
      name: '原姓名',
      role: 'sales',
      update: jest.fn()
    };
    const model = {
      findOrCreate: jest.fn().mockResolvedValue([employee, true])
    };
    const service = new EmployeeProvisioningService({ model });

    await service.provision({
      userId: 51,
      name: '原姓名',
      employeeRole: 'sales',
      wechatUserId: null,
      idempotencyKey: 'conflict-attempt-51'
    });
    await expect(service.provision({
      userId: 51,
      name: '篡改姓名',
      employeeRole: 'partner',
      wechatUserId: null,
      idempotencyKey: 'conflict-attempt-51'
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT'
    });
    expect(model.findOrCreate).toHaveBeenCalledTimes(1);
    expect(employee.update).not.toHaveBeenCalled();
  });

  test('不同 Idempotency-Key 对同一 user_id 串行执行，避免并发覆盖', async () => {
    let resolveFirst;
    const employee = {
      id: 22,
      user_id: 52,
      name: '第一姓名',
      role: 'sales',
      wechat_userid: null,
      update: jest.fn().mockResolvedValue(true)
    };
    const model = {
      findOrCreate: jest.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce([employee, false])
    };
    const service = new EmployeeProvisioningService({ model });

    const first = service.provision({
      userId: 52,
      name: '第一姓名',
      employeeRole: 'sales',
      idempotencyKey: 'attempt-first-52'
    });
    const second = service.provision({
      userId: 52,
      name: '第二姓名',
      employeeRole: 'partner',
      idempotencyKey: 'attempt-second-52'
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(model.findOrCreate).toHaveBeenCalledTimes(1);

    resolveFirst([employee, true]);
    await first;
    await second;
    expect(model.findOrCreate).toHaveBeenCalledTimes(2);
    expect(employee.update).toHaveBeenCalledWith({
      name: '第二姓名',
      role: 'partner'
    });
  });

  test('findOrCreate 的 user_id 唯一键竞态会回查已创建记录并按重复请求处理', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    const employee = {
      id: 23,
      user_id: 53,
      name: '并发已建档',
      role: 'sales',
      wechat_userid: null,
      update: jest.fn()
    };
    const model = {
      findOrCreate: jest.fn().mockRejectedValue(uniqueError),
      findOne: jest.fn().mockResolvedValue(employee)
    };
    const service = new EmployeeProvisioningService({ model });

    await expect(service.provision({
      userId: 53,
      name: '并发已建档',
      employeeRole: 'sales',
      idempotencyKey: 'unique-race-53'
    })).resolves.toEqual({ employee, created: false });
    expect(model.findOne).toHaveBeenCalledWith({ where: { user_id: 53 } });
  });

  test('唯一键错误后仍找不到对应 user_id 时返回明确 409', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    const service = new EmployeeProvisioningService({
      model: {
        findOrCreate: jest.fn().mockRejectedValue(uniqueError),
        findOne: jest.fn().mockResolvedValue(null)
      }
    });

    await expect(service.provision({
      userId: 54,
      name: '冲突用户',
      employeeRole: 'sales',
      idempotencyKey: 'unique-conflict-54'
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMPLOYEE_USER_ID_CONFLICT'
    });
  });

  test('幂等记录达到容量时保留已有 key 的重放结果，新 key fail-closed', async () => {
    const employee = {
      id: 24,
      user_id: 55,
      name: '容量用户',
      role: 'sales',
      update: jest.fn()
    };
    const model = { findOrCreate: jest.fn().mockResolvedValue([employee, true]) };
    const service = new EmployeeProvisioningService({
      model,
      maxIdempotencyRecords: 1
    });
    const firstPayload = {
      userId: 55,
      name: '容量用户',
      employeeRole: 'sales',
      idempotencyKey: 'capacity-key-55'
    };

    await expect(service.provision(firstPayload)).resolves.toEqual({ employee, created: true });
    await expect(service.provision(firstPayload)).resolves.toEqual({ employee, created: true });
    await expect(service.provision({
      userId: 56,
      name: '新用户',
      employeeRole: 'sales',
      idempotencyKey: 'capacity-key-56'
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PROVISION_IDEMPOTENCY_CAPACITY_EXCEEDED'
    });
    expect(model.findOrCreate).toHaveBeenCalledTimes(1);
  });
});
