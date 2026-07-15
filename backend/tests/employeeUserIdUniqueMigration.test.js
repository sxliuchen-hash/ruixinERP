const {
  INDEX_NAME,
  ensureEmployeeUserIdUnique
} = require('../scripts/run-employee-user-id-unique-migration');
const {
  createEmployeeSchema,
  updateEmployeeSchema
} = require('../src/validators/employee');
const errorHandler = require('../src/middlewares/errorHandler');

describe('employees.user_id 唯一索引迁移', () => {
  test('发现重复绑定时明确失败且不执行 ALTER TABLE', async () => {
    const sequelize = {
      query: jest.fn().mockResolvedValueOnce([[
        { user_id: 12, binding_count: 2 },
        { user_id: 30, binding_count: 3 }
      ], {}])
    };

    await expect(ensureEmployeeUserIdUnique(sequelize)).rejects.toThrow(
      '12(2), 30(3)'
    );
    expect(sequelize.query).toHaveBeenCalledTimes(1);
    expect(sequelize.query.mock.calls[0][0]).toMatch(/HAVING COUNT\(\*\) > 1/);
  });

  test('正确唯一索引已存在时安全跳过', async () => {
    const sequelize = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[
          { Key_name: INDEX_NAME, Non_unique: 0, Column_name: 'user_id' }
        ], {}])
    };

    await expect(ensureEmployeeUserIdUnique(sequelize)).resolves.toEqual({
      created: false,
      indexName: INDEX_NAME
    });
    expect(sequelize.query).toHaveBeenCalledTimes(2);
  });

  test('同名索引定义错误时失败，不自动覆盖', async () => {
    const sequelize = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[
          { Key_name: INDEX_NAME, Non_unique: 1, Column_name: 'user_id' }
        ], {}])
    };

    await expect(ensureEmployeeUserIdUnique(sequelize)).rejects.toThrow(
      '不是 user_id 单列唯一索引'
    );
    expect(sequelize.query).toHaveBeenCalledTimes(2);
  });

  test('无重复且无现有索引时创建唯一索引', async () => {
    const sequelize = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
    };

    await expect(ensureEmployeeUserIdUnique(sequelize)).resolves.toEqual({
      created: true,
      indexName: INDEX_NAME
    });
    expect(sequelize.query).toHaveBeenLastCalledWith(
      `ALTER TABLE employees ADD UNIQUE INDEX ${INDEX_NAME} (user_id)`
    );
  });

  test.each([0, -1, -100])('新建和更新员工都拒绝非正数 user_id=%s', (userId) => {
    const createResult = createEmployeeSchema.validate({
      user_id: userId,
      name: '测试员工',
      role: 'sales'
    });
    const updateResult = updateEmployeeSchema.validate({ user_id: userId });

    expect(createResult.error).toBeDefined();
    expect(updateResult.error).toBeDefined();
  });

  test('user_id 允许 null 解绑，正整数允许绑定', () => {
    expect(updateEmployeeSchema.validate({ user_id: null }).error).toBeUndefined();
    expect(updateEmployeeSchema.validate({ user_id: 18 }).error).toBeUndefined();
  });

  test('数据库唯一约束冲突统一返回 409，而不是 500 INTERNAL_ERROR', () => {
    const req = {
      originalUrl: '/api/v1/employees/3',
      method: 'PUT',
      ip: '127.0.0.1'
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const error = Object.assign(new Error('duplicate employees.user_id'), {
      name: 'SequelizeUniqueConstraintError',
      errors: []
    });

    errorHandler(error, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'DUPLICATE_ERROR'
    }));
  });
});
