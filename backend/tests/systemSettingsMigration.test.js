'use strict';

const fs = require('fs');
const path = require('path');

const {
  SYSTEM_SETTINGS_TABLE_SQL,
  DEFAULT_SETTING,
  DEFAULT_SETTING_INSERT_SQL,
  COLUMN_SPECS,
  buildSystemSettingsMigrationPlan,
  ensureSystemSettingsSchema,
  runCli
} = require('../scripts/run-system-settings-migration');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
}

function column(Field, Type, options = {}) {
  return {
    Field,
    Type,
    Null: options.nullable === false ? 'NO' : 'YES',
    Key: options.key || '',
    Default: options.defaultValue === undefined ? null : options.defaultValue,
    Extra: options.extra || ''
  };
}

function indexRows(name, columns, unique = false) {
  return columns.map((Column_name, index) => ({
    Key_name: name,
    Column_name,
    Seq_in_index: index + 1,
    Non_unique: unique ? 0 : 1
  }));
}

function completeSnapshot(overrides = {}) {
  return {
    exists: true,
    engine: 'InnoDB',
    collation: 'utf8mb4_unicode_ci',
    rowCount: 1,
    columns: [
      column('id', 'int', { nullable: false, key: 'PRI', extra: 'auto_increment' }),
      column('setting_key', 'varchar(100)', { nullable: false, key: 'UNI' }),
      column('setting_value', 'json', { nullable: false }),
      column('description', 'varchar(500)'),
      column('category', 'varchar(50)', { defaultValue: 'general' }),
      column('updated_by', 'int'),
      column('create_time', 'datetime', { defaultValue: 'CURRENT_TIMESTAMP' }),
      column('update_time', 'datetime', {
        defaultValue: 'CURRENT_TIMESTAMP()',
        extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP()'
      })
    ],
    indexes: [
      ...indexRows('PRIMARY', ['id'], true),
      ...indexRows('uk_setting_key', ['setting_key'], true),
      ...indexRows('idx_category', ['category'], false)
    ],
    settingKeyDuplicates: [],
    defaultSettingExists: true,
    ...overrides
  };
}

function replaceColumn(snapshot, field, replacement) {
  return {
    ...snapshot,
    columns: snapshot.columns.map((entry) => entry.Field === field ? replacement : entry)
  };
}

describe('system_settings 显式迁移', () => {
  test('缺失表时只创建正式结构并插入默认设置', () => {
    expect(buildSystemSettingsMigrationPlan({ exists: false })).toEqual([
      SYSTEM_SETTINGS_TABLE_SQL,
      DEFAULT_SETTING_INSERT_SQL
    ]);
    expect(SYSTEM_SETTINGS_TABLE_SQL).toContain('ENGINE=InnoDB');
    expect(SYSTEM_SETTINGS_TABLE_SQL).toContain('COLLATE=utf8mb4_unicode_ci');
    expect(DEFAULT_SETTING).toEqual({
      key: 'channel_sales_cost',
      value: { 发明: 1000, 实用新型: 200, 外观: 200, default: 500 },
      description: '渠道销售成本（按专利类型）',
      category: 'inventory'
    });
  });

  test('完整结构和已有默认配置的二次执行是只读 no-op', () => {
    expect(buildSystemSettingsMigrationPlan(completeSnapshot())).toEqual([]);
  });

  test('只补充可安全新增的非核心列、普通索引和缺失默认设置', () => {
    const snapshot = completeSnapshot({ defaultSettingExists: false });
    snapshot.columns = snapshot.columns.filter(({ Field }) => Field !== 'description');
    snapshot.indexes = snapshot.indexes.filter(({ Key_name }) => Key_name !== 'idx_category');

    expect(buildSystemSettingsMigrationPlan(snapshot)).toEqual([
      expect.stringContaining('ADD COLUMN `description` VARCHAR(500) DEFAULT NULL'),
      'ALTER TABLE `system_settings` ADD INDEX `idx_category` (`category`)',
      DEFAULT_SETTING_INSERT_SQL
    ]);
  });

  test('接受等价的单列唯一索引和分类普通索引，不强制改名', () => {
    const snapshot = completeSnapshot({
      indexes: [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('uq_settings_key_equivalent', ['setting_key'], true),
        ...indexRows('ix_settings_category_equivalent', ['category'], false)
      ]
    });
    expect(buildSystemSettingsMigrationPlan(snapshot)).toEqual([]);
  });

  test.each([
    ['核心列缺失', () => {
      const snapshot = completeSnapshot();
      snapshot.columns = snapshot.columns.filter(({ Field }) => Field !== 'setting_value');
      return snapshot;
    }, /setting_value 核心列缺失/],
    ['JSON 类型冲突', () => replaceColumn(
      completeSnapshot(),
      'setting_value',
      column('setting_value', 'longtext', { nullable: false })
    ), /setting_value 类型 longtext/],
    ['可空性冲突', () => replaceColumn(
      completeSnapshot(),
      'description',
      column('description', 'varchar(500)', { nullable: false })
    ), /description 可空性/],
    ['分类默认值冲突', () => replaceColumn(
      completeSnapshot(),
      'category',
      column('category', 'varchar(50)')
    ), /category 默认值/],
    ['自增属性缺失', () => replaceColumn(
      completeSnapshot(),
      'id',
      column('id', 'int', { nullable: false, key: 'PRI' })
    ), /不是 AUTO_INCREMENT/],
    ['更新时间自动维护缺失', () => replaceColumn(
      completeSnapshot(),
      'update_time',
      column('update_time', 'datetime', { defaultValue: 'CURRENT_TIMESTAMP' })
    ), /缺少 ON UPDATE CURRENT_TIMESTAMP/],
    ['存储引擎冲突', () => completeSnapshot({ engine: 'MyISAM' }), /不是 InnoDB/],
    ['字符集冲突', () => completeSnapshot({ collation: 'latin1_swedish_ci' }), /不是 utf8mb4/]
  ])('%s 时 fail-closed', (_label, snapshotFactory, expected) => {
    expect(() => buildSystemSettingsMigrationPlan(snapshotFactory())).toThrow(expected);
  });

  test('主键、同名索引、分类唯一索引或历史重复键冲突时 fail-closed', () => {
    expect(() => buildSystemSettingsMigrationPlan(completeSnapshot({
      indexes: [
        ...indexRows('PRIMARY', ['setting_key'], true),
        ...indexRows('uk_setting_key', ['setting_key'], true),
        ...indexRows('idx_category', ['category'], false)
      ]
    }))).toThrow(/主键不是 id/);

    expect(() => buildSystemSettingsMigrationPlan(completeSnapshot({
      indexes: [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('uk_setting_key', ['category'], true),
        ...indexRows('idx_category', ['category'], false)
      ]
    }))).toThrow(/uk_setting_key 已存在但定义不符合预期/);

    expect(() => buildSystemSettingsMigrationPlan(completeSnapshot({
      indexes: [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('uk_setting_key', ['setting_key'], true),
        ...indexRows('idx_category', ['category'], true)
      ]
    }))).toThrow(/category 存在唯一索引/);

    expect(() => buildSystemSettingsMigrationPlan(completeSnapshot({
      settingKeyDuplicates: [{ setting_key: 'duplicate', duplicate_count: 2 }]
    }))).toThrow(/duplicate\(2\)/);
  });

  test('探测缺失表后按顺序执行 CREATE 和默认 INSERT', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce([[], {}])
        .mockResolvedValue([[], {}])
    };

    await expect(ensureSystemSettingsSchema(database)).resolves.toEqual({
      changed: true,
      statements: [SYSTEM_SETTINGS_TABLE_SQL, DEFAULT_SETTING_INSERT_SQL]
    });
    const statements = database.query.mock.calls.map(([sql]) => sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('FROM `information_schema`.`TABLES`');
    expect(statements[0]).toContain("`TABLE_NAME` = 'system_settings'");
    expect(statements.slice(1)).toEqual([
      SYSTEM_SETTINGS_TABLE_SQL,
      DEFAULT_SETTING_INSERT_SQL
    ]);
  });

  test('CLI 失败设置非零退出码并可靠关闭连接，不调用 process.exit', async () => {
    const database = {
      authenticate: jest.fn().mockRejectedValue(new Error('connection refused')),
      close: jest.fn().mockResolvedValue()
    };
    const setExitCode = jest.fn();
    const logError = jest.fn();

    await expect(runCli({ database, setExitCode, logError, log: jest.fn() }))
      .resolves.toBeNull();
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(logError).toHaveBeenCalledWith(
      'system_settings 迁移失败:',
      'connection refused'
    );
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(readRepoFile('backend', 'scripts', 'run-system-settings-migration.js'))
      .not.toMatch(/process\.exit\s*\(/);
  });

  test('正式迁移、独立 SQL、新库初始化、模型和服务使用同一 schema 契约', () => {
    const initSql = readRepoFile('backend', 'scripts', 'init-database.sql');
    const addSql = readRepoFile('backend', 'scripts', 'add-system-settings.sql');
    const model = readRepoFile('backend', 'src', 'models', 'SystemSetting.js');
    const service = readRepoFile('backend', 'src', 'services', 'systemSettingService.js');

    for (const source of [SYSTEM_SETTINGS_TABLE_SQL, initSql, addSql]) {
      expect(source).toMatch(/`setting_key` VARCHAR\(100\) NOT NULL/);
      expect(source).toMatch(/`setting_value` JSON NOT NULL/);
      expect(source).toMatch(/`description` VARCHAR\(500\) DEFAULT NULL/);
      expect(source).toMatch(/`category` VARCHAR\(50\) DEFAULT 'general'/);
      expect(source).toMatch(/`updated_by` INT DEFAULT NULL/);
      expect(source).toContain('UNIQUE KEY `uk_setting_key` (`setting_key`)');
      expect(source).toContain('KEY `idx_category` (`category`)');
    }
    for (const source of [DEFAULT_SETTING_INSERT_SQL, initSql, addSql]) {
      expect(source).toContain("'channel_sales_cost'");
      expect(source).toContain('"发明": 1000');
      expect(source).toContain('"实用新型": 200');
      expect(source).toContain('"外观": 200');
      expect(source).toContain('"default": 500');
    }

    expect(Object.keys(COLUMN_SPECS)).toEqual([
      'id', 'setting_key', 'setting_value', 'description', 'category',
      'updated_by', 'create_time', 'update_time'
    ]);
    expect(model).toContain("tableName: 'system_settings'");
    expect(model).toContain('type: DataTypes.JSON');
    expect(model).toContain("createdAt: 'create_time'");
    expect(model).toContain("updatedAt: 'update_time'");
    expect(service).toContain("this.get('channel_sales_cost'");
  });

  test('package 和运维入口只使用受支持的 npm 迁移命令', () => {
    const packageJson = JSON.parse(readRepoFile('backend', 'package.json'));
    const operations = readRepoFile('docs', '部署运维手册.md');
    const addSql = readRepoFile('backend', 'scripts', 'add-system-settings.sql');

    expect(packageJson.scripts['migrate:system-settings']).toBe(
      'node scripts/run-system-settings-migration.js'
    );
    expect(packageJson.scripts['test:delivery-safety'])
      .toContain('tests/systemSettingsMigration.test.js');
    expect(operations).toContain('npm run migrate:system-settings');
    expect(operations).not.toContain('node scripts/run-system-settings-migration.js');
    expect(addSql).toContain('存量库必须执行：');
    expect(addSql).toContain('npm run migrate:system-settings');
  });
});
