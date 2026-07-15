/**
 * system_settings 显式结构迁移。
 *
 * 设计约束：
 * - 只通过此脚本人工执行，不挂载到应用启动或部署脚本。
 * - 在任何 DDL/DML 前完整读取表、列、索引、重复键和默认设置状态。
 * - 只创建缺失表、补充可安全新增的非核心列/索引，以及插入缺失的默认设置。
 * - 核心列缺失、既有列类型/可空性/默认值冲突、主键/同名索引冲突或
 *   setting_key 重复时 fail-closed，不推测性修改或清洗业务数据。
 */
'use strict';

const SYSTEM_SETTINGS_TABLE_SQL = `CREATE TABLE \`system_settings\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`setting_key\` VARCHAR(100) NOT NULL COMMENT '设置项键名',
  \`setting_value\` JSON NOT NULL COMMENT '设置项值（JSON）',
  \`description\` VARCHAR(500) DEFAULT NULL COMMENT '描述',
  \`category\` VARCHAR(50) DEFAULT 'general' COMMENT '分类',
  \`updated_by\` INT DEFAULT NULL COMMENT '最后修改人',
  \`create_time\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  \`update_time\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_setting_key\` (\`setting_key\`),
  KEY \`idx_category\` (\`category\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统设置'`;

const DEFAULT_SETTING = Object.freeze({
  key: 'channel_sales_cost',
  value: Object.freeze({ 发明: 1000, 实用新型: 200, 外观: 200, default: 500 }),
  description: '渠道销售成本（按专利类型）',
  category: 'inventory'
});

const DEFAULT_SETTING_INSERT_SQL = `INSERT INTO \`system_settings\`
  (\`setting_key\`, \`setting_value\`, \`description\`, \`category\`)
VALUES (
  'channel_sales_cost',
  '{"发明": 1000, "实用新型": 200, "外观": 200, "default": 500}',
  '渠道销售成本（按专利类型）',
  'inventory'
)`;

const COLUMN_SPECS = Object.freeze({
  id: {
    type: /^int(?:\(\d+\))?$/,
    nullable: false,
    core: true,
    autoIncrement: true
  },
  setting_key: {
    type: /^varchar\(100\)$/,
    nullable: false,
    core: true
  },
  setting_value: {
    type: /^json$/,
    nullable: false,
    core: true
  },
  description: {
    type: /^varchar\(500\)$/,
    nullable: true,
    ddl: "`description` VARCHAR(500) DEFAULT NULL COMMENT '描述'"
  },
  category: {
    type: /^varchar\(50\)$/,
    nullable: true,
    defaultValue: 'general',
    ddl: "`category` VARCHAR(50) DEFAULT 'general' COMMENT '分类'"
  },
  updated_by: {
    type: /^int(?:\(\d+\))?$/,
    nullable: true,
    ddl: "`updated_by` INT DEFAULT NULL COMMENT '最后修改人'"
  },
  create_time: {
    type: /^(?:datetime|timestamp)(?:\(\d+\))?$/,
    defaultCurrentTimestamp: true,
    ddl: '`create_time` DATETIME DEFAULT CURRENT_TIMESTAMP'
  },
  update_time: {
    type: /^(?:datetime|timestamp)(?:\(\d+\))?$/,
    defaultCurrentTimestamp: true,
    onUpdateCurrentTimestamp: true,
    ddl: '`update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  }
});

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

function normalizeType(type) {
  return String(type || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).toLowerCase().replace(/\(\)/g, '').trim();
}

function groupIndexes(rows) {
  const indexes = new Map();
  for (const row of rows || []) {
    if (!indexes.has(row.Key_name)) indexes.set(row.Key_name, []);
    indexes.get(row.Key_name).push(row);
  }
  for (const indexRows of indexes.values()) {
    indexRows.sort((left, right) => Number(left.Seq_in_index) - Number(right.Seq_in_index));
  }
  return indexes;
}

function isIndex(indexRows, columns, unique) {
  return Array.isArray(indexRows) &&
    indexRows.length === columns.length &&
    indexRows.every((row, index) => row.Column_name === columns[index]) &&
    (unique === undefined || indexRows.every(
      (row) => Number(row.Non_unique) === (unique ? 0 : 1)
    ));
}

function assertNamedIndexAvailable(indexes, name, columns, unique) {
  const rows = indexes.get(name);
  if (rows && !isIndex(rows, columns, unique)) {
    throw new Error(`索引 ${name} 已存在但定义不符合预期，请人工处理`);
  }
  return Boolean(rows);
}

function validateTableMetadata(table) {
  if (String(table.engine || '').toLowerCase() !== 'innodb') {
    throw new Error(`system_settings 存储引擎 ${table.engine || '未知'} 不是 InnoDB，请人工处理`);
  }
  const collation = String(table.collation || '').toLowerCase();
  if (!collation.startsWith('utf8mb4_')) {
    throw new Error(
      `system_settings 排序规则 ${table.collation || '未知'} 不是 utf8mb4，请人工处理`
    );
  }
}

function validateColumns(table, plan) {
  const columns = new Map((table.columns || []).map((row) => [row.Field, row]));

  for (const [field, spec] of Object.entries(COLUMN_SPECS)) {
    const column = columns.get(field);
    if (!column) {
      if (spec.core) {
        throw new Error(`system_settings.${field} 核心列缺失，请人工处理`);
      }
      plan.push(`ALTER TABLE \`system_settings\` ADD COLUMN ${spec.ddl}`);
      columns.set(field, { Field: field, Type: spec.ddl });
      continue;
    }

    const actualType = normalizeType(column.Type);
    if (!spec.type.test(actualType)) {
      throw new Error(
        `system_settings.${field} 类型 ${column.Type || '未知'} 与预期冲突，请人工处理`
      );
    }

    if (spec.nullable !== undefined) {
      const actualNullable = String(column.Null || '').toUpperCase() === 'YES';
      if (actualNullable !== spec.nullable) {
        throw new Error(
          `system_settings.${field} 可空性与预期冲突，请人工处理`
        );
      }
    }

    if (spec.autoIncrement && !/\bauto_increment\b/i.test(String(column.Extra || ''))) {
      throw new Error('system_settings.id 不是 AUTO_INCREMENT，请人工处理');
    }

    if (Object.prototype.hasOwnProperty.call(spec, 'defaultValue') &&
        normalizeDefault(column.Default) !== normalizeDefault(spec.defaultValue)) {
      throw new Error(`system_settings.${field} 默认值与预期冲突，请人工处理`);
    }

    if (spec.defaultCurrentTimestamp &&
        normalizeDefault(column.Default) !== 'current_timestamp') {
      throw new Error(`system_settings.${field} 缺少 CURRENT_TIMESTAMP 默认值，请人工处理`);
    }

    if (spec.onUpdateCurrentTimestamp &&
        !/on update current_timestamp(?:\(\))?/i.test(String(column.Extra || ''))) {
      throw new Error(
        `system_settings.${field} 缺少 ON UPDATE CURRENT_TIMESTAMP，请人工处理`
      );
    }
  }

  return columns;
}

function buildSystemSettingsMigrationPlan(snapshot) {
  if (!snapshot || !snapshot.exists) {
    return [SYSTEM_SETTINGS_TABLE_SQL, DEFAULT_SETTING_INSERT_SQL];
  }

  validateTableMetadata(snapshot);
  const plan = [];
  const columns = validateColumns(snapshot, plan);
  const indexes = groupIndexes(snapshot.indexes);

  if (!isIndex(indexes.get('PRIMARY'), ['id'], true)) {
    throw new Error('system_settings 主键不是 id 单列主键，请人工处理');
  }

  if ((snapshot.settingKeyDuplicates || []).length > 0) {
    const summary = snapshot.settingKeyDuplicates
      .map((row) => `${row.setting_key}(${row.duplicate_count})`).join(', ');
    throw new Error(`system_settings.setting_key 存在重复值，请先人工处理：${summary}`);
  }

  const namedUniqueExists = assertNamedIndexAvailable(
    indexes, 'uk_setting_key', ['setting_key'], true
  );
  const equivalentUniqueExists = [...indexes.values()]
    .some((rows) => isIndex(rows, ['setting_key'], true));
  if (!namedUniqueExists && !equivalentUniqueExists) {
    plan.push(
      'ALTER TABLE `system_settings` ADD UNIQUE INDEX `uk_setting_key` (`setting_key`)'
    );
  }

  if (columns.has('category')) {
    const unexpectedUniqueCategory = [...indexes.values()]
      .some((rows) => isIndex(rows, ['category'], true));
    if (unexpectedUniqueCategory) {
      throw new Error('system_settings.category 存在唯一索引，与普通分类索引预期冲突，请人工处理');
    }
    const namedCategoryExists = assertNamedIndexAvailable(
      indexes, 'idx_category', ['category'], false
    );
    const equivalentCategoryExists = [...indexes.values()]
      .some((rows) => isIndex(rows, ['category'], false));
    if (!namedCategoryExists && !equivalentCategoryExists) {
      plan.push('ALTER TABLE `system_settings` ADD INDEX `idx_category` (`category`)');
    }
  }

  if (!snapshot.defaultSettingExists) plan.push(DEFAULT_SETTING_INSERT_SQL);
  return plan;
}

async function inspectSystemSettingsSchema(sequelize) {
  const tableRows = normalizeQueryRows(
    await sequelize.query(`
      SELECT \`TABLE_NAME\` AS \`Name\`, \`ENGINE\` AS \`Engine\`,
             \`TABLE_COLLATION\` AS \`Collation\`
      FROM \`information_schema\`.\`TABLES\`
      WHERE \`TABLE_SCHEMA\` = DATABASE()
        AND \`TABLE_NAME\` = 'system_settings'
      LIMIT 1
    `)
  ) || [];
  if (tableRows.length === 0) {
    return {
      exists: false,
      columns: [],
      indexes: [],
      rowCount: 0,
      settingKeyDuplicates: [],
      defaultSettingExists: false
    };
  }

  const tableStatus = tableRows[0];
  const columns = normalizeQueryRows(
    await sequelize.query('SHOW FULL COLUMNS FROM `system_settings`')
  ) || [];
  const indexes = normalizeQueryRows(
    await sequelize.query('SHOW INDEX FROM `system_settings`')
  ) || [];
  const countRows = normalizeQueryRows(
    await sequelize.query('SELECT COUNT(*) AS row_count FROM `system_settings`')
  ) || [];
  const settingKeyDuplicates = normalizeQueryRows(await sequelize.query(`
    SELECT \`setting_key\`, COUNT(*) AS duplicate_count
    FROM \`system_settings\`
    GROUP BY \`setting_key\`
    HAVING COUNT(*) > 1
    ORDER BY \`setting_key\`
    LIMIT 20
  `)) || [];
  const defaultRows = normalizeQueryRows(await sequelize.query(`
    SELECT \`setting_key\`
    FROM \`system_settings\`
    WHERE \`setting_key\` = 'channel_sales_cost'
    LIMIT 1
  `)) || [];

  return {
    exists: true,
    engine: tableStatus.Engine,
    collation: tableStatus.Collation,
    columns,
    indexes,
    rowCount: Number(countRows[0] && countRows[0].row_count) || 0,
    settingKeyDuplicates,
    defaultSettingExists: defaultRows.length === 1
  };
}

async function ensureSystemSettingsSchema(sequelize) {
  const snapshot = await inspectSystemSettingsSchema(sequelize);
  const statements = buildSystemSettingsMigrationPlan(snapshot);
  for (const sql of statements) await sequelize.query(sql);
  return { changed: statements.length > 0, statements };
}

async function runCli({
  database,
  log = console.log,
  logError = console.error,
  setExitCode = (code) => { process.exitCode = code; }
} = {}) {
  let sequelize = database;
  try {
    if (!sequelize) {
      require('dotenv').config();
      ({ sequelize } = require('../src/config/database'));
    }
    await sequelize.authenticate();
    const result = await ensureSystemSettingsSchema(sequelize);
    log(result.changed
      ? `✓ system_settings 迁移完成，共执行 ${result.statements.length} 条语句`
      : '✓ system_settings 结构和默认设置已符合预期，无需修改');
    return result;
  } catch (error) {
    logError('system_settings 迁移失败:', error.message);
    setExitCode(1);
    return null;
  } finally {
    if (sequelize && typeof sequelize.close === 'function') await sequelize.close();
  }
}

if (require.main === module) runCli();

module.exports = {
  SYSTEM_SETTINGS_TABLE_SQL,
  DEFAULT_SETTING,
  DEFAULT_SETTING_INSERT_SQL,
  COLUMN_SPECS,
  normalizeQueryRows,
  normalizeType,
  normalizeDefault,
  groupIndexes,
  isIndex,
  buildSystemSettingsMigrationPlan,
  inspectSystemSettingsSchema,
  ensureSystemSettingsSchema,
  runCli
};
