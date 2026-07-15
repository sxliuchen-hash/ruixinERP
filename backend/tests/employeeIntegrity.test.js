const {
  createEmployeeSchema,
  updateEmployeeSchema
} = require('../src/validators/employee');
const {
  EmployeeService,
  mapEmployeeWriteError
} = require('../src/services/employeeService');
const {
  INDEX_NAME,
  assertEmployeeUserIdUniqueIndex
} = require('../src/services/employeeIndexGuard');

describe('员工与主项目账号一对一完整性', () => {
  test.each([0, -1, 1.5])('create user_id=%p 时校验失败', (userId) => {
    const result = createEmployeeSchema.validate({
      user_id: userId,
      name: '测试员工',
      role: 'sales'
    });
    expect(result.error).toBeDefined();
  });

  test.each([0, -2, 2.5])('update user_id=%p 时校验失败', (userId) => {
    expect(updateEmployeeSchema.validate({ user_id: userId }).error).toBeDefined();
  });

  test.each([null, 1, 99])('user_id=%p 合法', (userId) => {
    expect(createEmployeeSchema.validate({
      user_id: userId,
      name: '测试员工',
      role: 'sales'
    }).error).toBeUndefined();
    expect(updateEmployeeSchema.validate({ user_id: userId }).error).toBeUndefined();
  });

  test('创建绑定的唯一约束冲突映射为明确 409', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    const model = { create: jest.fn().mockRejectedValue(uniqueError) };
    const service = new EmployeeService({ model });

    await expect(service.create({ user_id: 7 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMPLOYEE_USER_ID_CONFLICT'
    });
    expect(mapEmployeeWriteError(uniqueError)).toMatchObject({ statusCode: 409 });
  });

  test('更新绑定的唯一约束冲突同样返回 409', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    const employee = { update: jest.fn().mockRejectedValue(uniqueError) };
    const service = new EmployeeService({ model: {} });

    await expect(service.update(employee, { user_id: 8 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMPLOYEE_USER_ID_CONFLICT'
    });
  });

  test('启动检查只接受 user_id 单列唯一索引', async () => {
    const sequelize = {
      query: jest.fn().mockResolvedValue([[
        { Key_name: INDEX_NAME, Non_unique: 0, Column_name: 'user_id' }
      ], {}])
    };
    await expect(assertEmployeeUserIdUniqueIndex(sequelize)).resolves.toBe(true);
  });

  test.each([
    ['索引缺失', []],
    ['索引非唯一', [{ Key_name: INDEX_NAME, Non_unique: 1, Column_name: 'user_id' }]],
    ['索引字段错误', [{ Key_name: INDEX_NAME, Non_unique: 0, Column_name: 'wechat_userid' }]]
  ])('%s 时启动检查失败且不自动修改数据库', async (_label, rows) => {
    const sequelize = { query: jest.fn().mockResolvedValue([rows, {}]) };

    await expect(assertEmployeeUserIdUniqueIndex(sequelize)).rejects.toThrow(
      'npm run migrate:employee-user-id-unique'
    );
    expect(sequelize.query).toHaveBeenCalledTimes(1);
    expect(sequelize.query.mock.calls[0][0]).toMatch(/^SHOW INDEX/);
  });
});
