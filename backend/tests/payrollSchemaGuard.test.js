'use strict';

const {
  PayrollSchemaGuardError,
  assertPayrollSchemaReady
} = require('../src/services/payrollSchemaGuard');

describe('薪酬数据库结构只读门禁', () => {
  test('完整结构通过且不执行迁移计划中的任何 SQL', async () => {
    const database = { query: jest.fn() };
    const snapshot = { marker: 'complete' };
    const inspectSchema = jest.fn().mockResolvedValue(snapshot);
    const buildMigrationPlan = jest.fn().mockReturnValue([]);

    await expect(assertPayrollSchemaReady(database, {
      inspectSchema,
      buildMigrationPlan
    })).resolves.toBe(true);

    expect(inspectSchema).toHaveBeenCalledWith(database);
    expect(buildMigrationPlan).toHaveBeenCalledWith(snapshot);
    expect(database.query).not.toHaveBeenCalled();
  });

  test('缺失结构生成待迁移计划时 fail-closed，绝不执行 DDL', async () => {
    const database = { query: jest.fn() };
    const inspectSchema = jest.fn().mockResolvedValue({});
    const buildMigrationPlan = jest.fn().mockReturnValue([
      'CREATE TABLE `salary_rules` (...)',
      'ALTER TABLE `payrolls` ADD COLUMN `voided_reason` VARCHAR(255)'
    ]);

    let caught;
    try {
      await assertPayrollSchemaReady(database, { inspectSchema, buildMigrationPlan });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayrollSchemaGuardError);
    expect(caught).toMatchObject({
      code: 'PAYROLL_SCHEMA_MIGRATION_REQUIRED',
      pendingStatementCount: 2
    });
    expect(caught.message).not.toContain('CREATE TABLE');
    expect(database.query).not.toHaveBeenCalled();
  });

  test('默认探测器在缺失结构时也只执行 SHOW/SELECT，不执行生成的 DDL', async () => {
    const database = {
      query: jest.fn(async (sql) => {
        if (sql === "SHOW TABLES LIKE 'salary\\_rules'") return [[], {}];
        if (sql === "SHOW TABLES LIKE 'payrolls'") return [[], {}];
        if (sql === "SHOW TABLES LIKE 'patent\\_inventory'") {
          return [[{ table: 'patent_inventory' }], {}];
        }
        if (sql === 'SHOW COLUMNS FROM `patent_inventory`') {
          return [[{ Field: 'purchaser_id', Type: 'int' }], {}];
        }
        if (sql === 'SHOW INDEX FROM `patent_inventory`') return [[], {}];
        throw new Error(`unexpected query: ${sql}`);
      })
    };

    await expect(assertPayrollSchemaReady(database)).rejects.toMatchObject({
      code: 'PAYROLL_SCHEMA_MIGRATION_REQUIRED',
      pendingStatementCount: 2
    });
    expect(database.query).toHaveBeenCalledTimes(5);
    for (const [sql] of database.query.mock.calls) {
      expect(sql.trim()).toMatch(/^SHOW\b/i);
      expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i);
    }
  });

  test('冲突结构以独立安全错误拒绝，不暴露检查器原始详情', async () => {
    const database = {};
    const inspectSchema = jest.fn().mockResolvedValue({});
    const buildMigrationPlan = jest.fn(() => {
      throw new Error('payrolls.net_salary varchar(50), raw database detail');
    });

    await expect(assertPayrollSchemaReady(database, {
      inspectSchema,
      buildMigrationPlan
    })).rejects.toMatchObject({
      name: 'PayrollSchemaGuardError',
      code: 'PAYROLL_SCHEMA_CONFLICT',
      message: '薪酬数据库结构存在冲突'
    });
  });

  test('结构探测失败与非法计划结果均 fail-closed', async () => {
    await expect(assertPayrollSchemaReady({}, {
      inspectSchema: jest.fn().mockRejectedValue(new Error('db secret'))
    })).rejects.toMatchObject({ code: 'PAYROLL_SCHEMA_INSPECTION_FAILED' });

    await expect(assertPayrollSchemaReady({}, {
      inspectSchema: jest.fn().mockResolvedValue({}),
      buildMigrationPlan: jest.fn().mockReturnValue(null)
    })).rejects.toMatchObject({ code: 'PAYROLL_SCHEMA_GUARD_INVALID_RESULT' });
  });
});
