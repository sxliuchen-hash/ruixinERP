'use strict';

const packageJson = require('../package.json');
const PerformanceImport = require('../src/models/PerformanceImport');
const { sequelize } = require('../src/config/database');
const performanceUploadService = require('../src/services/performanceUploadService');
const {
  GENERATED_COLUMN,
  INDEX_NAME,
  assertPerformanceImportConfirmedPeriodUniqueIndex
} = require('../src/services/performanceImportIndexGuard');
const {
  GENERATED_COLUMN_SQL,
  ensurePerformanceConfirmedPeriodUnique
} = require('../scripts/run-performance-confirmed-period-unique-migration');

function validGeneratedColumnRow() {
  return {
    COLUMN_NAME: GENERATED_COLUMN,
    DATA_TYPE: 'varchar',
    CHARACTER_MAXIMUM_LENGTH: 16,
    EXTRA: 'STORED GENERATED',
    GENERATION_EXPRESSION:
      "case when (`status` = _utf8mb4'confirmed') then concat(`year`,_utf8mb4'-',lpad(`month`,2,_utf8mb4'0')) else NULL end"
  };
}

function validIndexRow() {
  return {
    Key_name: INDEX_NAME,
    Non_unique: 0,
    Column_name: GENERATED_COLUMN
  };
}

describe('业绩已确认年月数据库级唯一约束', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('新库模型和显式迁移命令声明同一生成列唯一索引', () => {
    expect(packageJson.scripts['migrate:performance-confirmed-period-unique'])
      .toBe('node scripts/run-performance-confirmed-period-unique-migration.js');
    expect(GENERATED_COLUMN_SQL).toContain("CASE WHEN `status` = 'confirmed'");
    expect(GENERATED_COLUMN_SQL).toContain('ELSE NULL');
    expect(PerformanceImport.rawAttributes.confirmed_period_key).toMatchObject({
      allowNull: true
    });
    expect(PerformanceImport.options.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: INDEX_NAME,
        unique: true,
        fields: [GENERATED_COLUMN]
      })
    ]));
  });

  test('存量 confirmed 重复时 fail-closed，DDL 尚未执行', async () => {
    const sequelizeMock = {
      query: jest.fn().mockResolvedValueOnce([[
        { year: 2026, month: 6, duplicate_count: 2 },
        { year: 2026, month: 7, duplicate_count: 3 }
      ], {}])
    };

    await expect(ensurePerformanceConfirmedPeriodUnique(sequelizeMock))
      .rejects.toThrow('2026-06(2), 2026-07(3)');
    expect(sequelizeMock.query).toHaveBeenCalledTimes(1);
    expect(sequelizeMock.query.mock.calls[0][0]).toMatch(/HAVING COUNT\(\*\) > 1/);
  });

  test('无重复且约束缺失时一次 DDL 创建生成列和唯一索引', async () => {
    const sequelizeMock = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
    };

    await expect(ensurePerformanceConfirmedPeriodUnique(sequelizeMock)).resolves.toEqual({
      columnCreated: true,
      indexCreated: true,
      columnName: GENERATED_COLUMN,
      indexName: INDEX_NAME
    });
    const ddl = sequelizeMock.query.mock.calls[3][0];
    expect(ddl).toContain(`ADD COLUMN ${GENERATED_COLUMN_SQL}`);
    expect(ddl).toContain(`ADD UNIQUE INDEX \`${INDEX_NAME}\` (\`${GENERATED_COLUMN}\`)`);
  });

  test('正确约束已存在时幂等跳过，错误定义则停止', async () => {
    const existing = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[validGeneratedColumnRow()], {}])
        .mockResolvedValueOnce([[validIndexRow()], {}])
    };
    await expect(ensurePerformanceConfirmedPeriodUnique(existing)).resolves.toMatchObject({
      columnCreated: false,
      indexCreated: false
    });
    expect(existing.query).toHaveBeenCalledTimes(3);

    const invalid = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[
          { ...validGeneratedColumnRow(), GENERATION_EXPRESSION: '`year`' }
        ], {}])
        .mockResolvedValueOnce([[], {}])
    };
    await expect(ensurePerformanceConfirmedPeriodUnique(invalid))
      .rejects.toThrow('生成表达式或类型不符合预期');
    expect(invalid.query).toHaveBeenCalledTimes(3);
  });

  test('启动只读门禁校验生成列和唯一索引', async () => {
    const valid = {
      query: jest.fn()
        .mockResolvedValueOnce([[validGeneratedColumnRow()], {}])
        .mockResolvedValueOnce([[validIndexRow()], {}])
    };
    await expect(assertPerformanceImportConfirmedPeriodUniqueIndex(valid)).resolves.toBe(true);

    const missing = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValueOnce([[], {}])
    };
    await expect(assertPerformanceImportConfirmedPeriodUniqueIndex(missing))
      .rejects.toThrow('migrate:performance-confirmed-period-unique');
  });

  test('接受 MySQL 8.0/mysql2 返回的反斜杠转义字符串字面量', async () => {
    const escaped = {
      ...validGeneratedColumnRow(),
      GENERATION_EXPRESSION:
        "(case when (`status` = _utf8mb4\\'confirmed\\') then " +
        "concat(`year`,_utf8mb4\\'-\\',lpad(`month`,2,_utf8mb4\\'0\\')) else NULL end)"
    };
    const mysql80 = {
      query: jest.fn()
        .mockResolvedValueOnce([[escaped], {}])
        .mockResolvedValueOnce([[validIndexRow()], {}])
    };

    await expect(assertPerformanceImportConfirmedPeriodUniqueIndex(mysql80)).resolves.toBe(true);
  });

  test('并发唯一冲突被服务映射为可识别的业务校验错误', async () => {
    jest.spyOn(PerformanceImport, 'findOne').mockResolvedValue(null);
    jest.spyOn(sequelize, 'transaction').mockRejectedValue(Object.assign(
      new Error(`Duplicate entry for key '${INDEX_NAME}'`),
      {
        name: 'SequelizeUniqueConstraintError',
        fields: { confirmed_period_key: '2026-07' },
        parent: { code: 'ER_DUP_ENTRY', sqlMessage: `for key '${INDEX_NAME}'` }
      }
    ));

    await expect(performanceUploadService.confirmImport({
      year: 2026,
      month: 7,
      file_name: 'performance.xlsx',
      records: [{ employee_id: 1, employee_name: '测试', performance_amount: 100 }],
      userId: 1
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('2026年7月已存在已确认的业绩批次')
    });
  });
});
