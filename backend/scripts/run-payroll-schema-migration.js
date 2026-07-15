/**
 * 薪酬模块显式结构迁移。
 *
 * 设计约束：
 * - 只通过此脚本人工执行，不挂载到应用启动流程。
 * - 先读取所有相关表、列和索引，再生成确定的 DDL 计划。
 * - 只创建缺失表、增加缺失列/索引，以及把旧 payrolls.status ENUM
 *   扩展为包含 voided；不删除、重命名或清洗业务数据。
 * - 遇到不兼容的既有类型、主键、同名索引或重复 rule_type 时失败并
 *   要求人工处理。
 */
'use strict';

const SALARY_RULES_TABLE_SQL = `CREATE TABLE \`salary_rules\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`rule_type\` VARCHAR(50) NOT NULL,
  \`rule_name\` VARCHAR(100) NOT NULL,
  \`rule_data\` JSON NOT NULL,
  \`remark\` TEXT DEFAULT NULL,
  \`create_time\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`update_time\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_salary_rules_rule_type\` (\`rule_type\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='薪酬规则配置表'`;

const PAYROLLS_TABLE_SQL = `CREATE TABLE \`payrolls\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`employee_id\` INT NOT NULL,
  \`year\` INT NOT NULL,
  \`month\` INT NOT NULL,
  \`base_salary\` DECIMAL(10,2) DEFAULT 0.00,
  \`position_allowance\` DECIMAL(10,2) DEFAULT 0.00,
  \`attendance_bonus\` DECIMAL(10,2) DEFAULT 0.00,
  \`grade_allowance\` DECIMAL(10,2) DEFAULT 0.00,
  \`commission\` DECIMAL(10,2) DEFAULT 0.00,
  \`purchase_commission\` DECIMAL(10,2) DEFAULT 0.00,
  \`bonus\` DECIMAL(10,2) DEFAULT 0.00,
  \`social_insurance\` DECIMAL(10,2) DEFAULT 0.00,
  \`income_tax\` DECIMAL(10,2) DEFAULT 0.00,
  \`leave_days\` DECIMAL(4,1) DEFAULT 0.0,
  \`personal_leave_days\` DECIMAL(4,1) DEFAULT 0.0,
  \`sick_leave_days\` DECIMAL(4,1) DEFAULT 0.0,
  \`leave_deduction\` DECIMAL(10,2) DEFAULT 0.00,
  \`other_deduction\` DECIMAL(10,2) DEFAULT 0.00,
  \`gross_income\` DECIMAL(10,2) DEFAULT 0.00,
  \`total_deduction\` DECIMAL(10,2) DEFAULT 0.00,
  \`net_salary\` DECIMAL(10,2) DEFAULT 0.00,
  \`monthly_profit\` DECIMAL(12,2) DEFAULT 0.00,
  \`contract_count\` INT DEFAULT 0,
  \`status\` ENUM('draft','confirmed','paid','voided') DEFAULT 'draft',
  \`is_adjustment\` TINYINT(1) DEFAULT 0,
  \`adjust_source_id\` INT DEFAULT NULL,
  \`voided_reason\` VARCHAR(255) DEFAULT NULL,
  \`remark\` TEXT DEFAULT NULL,
  \`confirmed_by\` INT DEFAULT NULL,
  \`confirmed_at\` DATETIME DEFAULT NULL,
  \`create_time\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`update_time\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_payrolls_employee_period\` (\`employee_id\`, \`year\`, \`month\`),
  KEY \`idx_payrolls_status\` (\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工月度工资条'`;

const COLUMN_SPECS = {
  salary_rules: {
    id: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`id` INT NOT NULL AUTO_INCREMENT', requiredOnPopulated: true },
    rule_type: { type: /^varchar\(50\)$/, ddl: '`rule_type` VARCHAR(50) NOT NULL', requiredOnPopulated: true },
    rule_name: { type: /^varchar\(100\)$/, ddl: '`rule_name` VARCHAR(100) NOT NULL', requiredOnPopulated: true },
    rule_data: { type: /^json$/, ddl: '`rule_data` JSON NOT NULL', requiredOnPopulated: true },
    remark: { type: /^(?:text|mediumtext|longtext)$/, ddl: '`remark` TEXT DEFAULT NULL' },
    create_time: { type: /^(?:datetime|timestamp)(?:\(\d+\))?$/, ddl: '`create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' },
    update_time: { type: /^(?:datetime|timestamp)(?:\(\d+\))?$/, ddl: '`update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
  },
  payrolls: {
    id: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`id` INT NOT NULL AUTO_INCREMENT', requiredOnPopulated: true },
    employee_id: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`employee_id` INT NOT NULL', requiredOnPopulated: true },
    year: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`year` INT NOT NULL', requiredOnPopulated: true },
    month: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`month` INT NOT NULL', requiredOnPopulated: true },
    base_salary: { type: /^decimal\(10,2\)$/, ddl: '`base_salary` DECIMAL(10,2) DEFAULT 0.00' },
    position_allowance: { type: /^decimal\(10,2\)$/, ddl: '`position_allowance` DECIMAL(10,2) DEFAULT 0.00' },
    attendance_bonus: { type: /^decimal\(10,2\)$/, ddl: '`attendance_bonus` DECIMAL(10,2) DEFAULT 0.00' },
    grade_allowance: { type: /^decimal\(10,2\)$/, ddl: '`grade_allowance` DECIMAL(10,2) DEFAULT 0.00' },
    commission: { type: /^decimal\(10,2\)$/, ddl: '`commission` DECIMAL(10,2) DEFAULT 0.00' },
    purchase_commission: { type: /^decimal\(10,2\)$/, ddl: '`purchase_commission` DECIMAL(10,2) DEFAULT 0.00' },
    bonus: { type: /^decimal\(10,2\)$/, ddl: '`bonus` DECIMAL(10,2) DEFAULT 0.00' },
    social_insurance: { type: /^decimal\(10,2\)$/, ddl: '`social_insurance` DECIMAL(10,2) DEFAULT 0.00' },
    income_tax: { type: /^decimal\(10,2\)$/, ddl: '`income_tax` DECIMAL(10,2) DEFAULT 0.00' },
    leave_days: { type: /^decimal\(4,1\)$/, ddl: '`leave_days` DECIMAL(4,1) DEFAULT 0.0' },
    personal_leave_days: { type: /^decimal\(4,1\)$/, ddl: '`personal_leave_days` DECIMAL(4,1) DEFAULT 0.0' },
    sick_leave_days: { type: /^decimal\(4,1\)$/, ddl: '`sick_leave_days` DECIMAL(4,1) DEFAULT 0.0' },
    leave_deduction: { type: /^decimal\(10,2\)$/, ddl: '`leave_deduction` DECIMAL(10,2) DEFAULT 0.00' },
    other_deduction: { type: /^decimal\(10,2\)$/, ddl: '`other_deduction` DECIMAL(10,2) DEFAULT 0.00' },
    gross_income: { type: /^decimal\(10,2\)$/, ddl: '`gross_income` DECIMAL(10,2) DEFAULT 0.00' },
    total_deduction: { type: /^decimal\(10,2\)$/, ddl: '`total_deduction` DECIMAL(10,2) DEFAULT 0.00' },
    net_salary: { type: /^decimal\(10,2\)$/, ddl: '`net_salary` DECIMAL(10,2) DEFAULT 0.00' },
    monthly_profit: { type: /^decimal\(12,2\)$/, ddl: '`monthly_profit` DECIMAL(12,2) DEFAULT 0.00' },
    contract_count: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`contract_count` INT DEFAULT 0' },
    status: { type: /^enum\(/, ddl: "`status` ENUM('draft','confirmed','paid','voided') DEFAULT 'draft'" },
    is_adjustment: { type: /^(?:tinyint\(1\)|tinyint)$/, ddl: '`is_adjustment` TINYINT(1) DEFAULT 0' },
    adjust_source_id: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`adjust_source_id` INT DEFAULT NULL' },
    voided_reason: { type: /^varchar\(255\)$/, ddl: '`voided_reason` VARCHAR(255) DEFAULT NULL' },
    remark: { type: /^(?:text|mediumtext|longtext)$/, ddl: '`remark` TEXT DEFAULT NULL' },
    confirmed_by: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: '`confirmed_by` INT DEFAULT NULL' },
    confirmed_at: { type: /^(?:datetime|timestamp)(?:\(\d+\))?$/, ddl: '`confirmed_at` DATETIME DEFAULT NULL' },
    create_time: { type: /^(?:datetime|timestamp)(?:\(\d+\))?$/, ddl: '`create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' },
    update_time: { type: /^(?:datetime|timestamp)(?:\(\d+\))?$/, ddl: '`update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
  },
  patent_inventory: {
    purchaser_id: { type: /^int(?:\(\d+\))?(?: unsigned)?$/, ddl: "`purchaser_id` INT DEFAULT NULL COMMENT '采购人员(employees.id)'" }
  }
};

const EXPECTED_PAYROLL_STATUS = ['draft', 'confirmed', 'paid', 'voided'];

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

function normalizeType(type) {
  return String(type || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function enumValues(type) {
  const normalized = normalizeType(type);
  if (!normalized.startsWith('enum(')) return null;
  const values = [];
  const matcher = /'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = matcher.exec(normalized))) values.push(match[1].replace(/\\'/g, "'"));
  return values;
}

function groupIndexes(rows) {
  const indexes = new Map();
  for (const row of rows || []) {
    const name = row.Key_name;
    if (!indexes.has(name)) indexes.set(name, []);
    indexes.get(name).push(row);
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
    (unique === undefined || indexRows.every((row) => Number(row.Non_unique) === (unique ? 0 : 1)));
}

function hasUniqueIndexWithPrefix(indexes, columns) {
  return [...indexes.values()].some((rows) =>
    rows.length >= columns.length &&
    rows.slice(0, columns.length).every((row, index) => row.Column_name === columns[index]) &&
    rows.every((row) => Number(row.Non_unique) === 0)
  );
}

function assertNamedIndexAvailable(indexes, name, columns, unique) {
  const rows = indexes.get(name);
  if (rows && !isIndex(rows, columns, unique)) {
    throw new Error(`索引 ${name} 已存在但定义不符合预期，请人工处理`);
  }
  return Boolean(rows);
}

function validateColumns(tableName, table, plan) {
  const specs = COLUMN_SPECS[tableName];
  const columns = new Map((table.columns || []).map((row) => [row.Field, row]));

  for (const [field, spec] of Object.entries(specs)) {
    const column = columns.get(field);
    if (!column) {
      if (spec.requiredOnPopulated && Number(table.rowCount || 0) > 0) {
        throw new Error(`${tableName}.${field} 缺失且表内已有数据，无法安全补列，请人工处理`);
      }
      plan.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${spec.ddl}`);
      // 后续索引规划应把本次即将新增的列视为已存在，确保一次迁移即可收敛。
      columns.set(field, { Field: field, Type: spec.ddl });
      continue;
    }

    const actualType = normalizeType(column.Type);
    if (!spec.type.test(actualType)) {
      throw new Error(
        `${tableName}.${field} 类型 ${column.Type} 与预期严重冲突，请人工处理`
      );
    }

    if (tableName === 'payrolls' && field === 'status') {
      const actualValues = enumValues(actualType);
      const minimumValues = EXPECTED_PAYROLL_STATUS.slice(0, 3);
      const hasMinimum = minimumValues.every((value) => actualValues.includes(value));
      const hasUnknown = actualValues.some((value) => !EXPECTED_PAYROLL_STATUS.includes(value));
      if (!hasMinimum || hasUnknown) {
        throw new Error(`payrolls.status ENUM 值与预期严重冲突，请人工处理`);
      }
      if (!actualValues.includes('voided')) {
        plan.push(
          "ALTER TABLE `payrolls` MODIFY COLUMN `status` " +
          "ENUM('draft','confirmed','paid','voided') DEFAULT 'draft'"
        );
      }
    }
  }

  return columns;
}

function buildPayrollSchemaMigrationPlan(snapshot) {
  const plan = [];
  const salaryRules = snapshot.salary_rules || { exists: false };
  const payrolls = snapshot.payrolls || { exists: false };
  const patentInventory = snapshot.patent_inventory || { exists: false };

  if (!salaryRules.exists) {
    plan.push(SALARY_RULES_TABLE_SQL);
  } else {
    const columns = validateColumns('salary_rules', salaryRules, plan);
    const indexes = groupIndexes(salaryRules.indexes);
    const primary = indexes.get('PRIMARY');
    if (!isIndex(primary, ['id'], true)) {
      throw new Error('salary_rules 主键不是 id 单列主键，请人工处理');
    }
    if (columns.has('rule_type')) {
      if ((salaryRules.ruleTypeDuplicates || []).length > 0) {
        const summary = salaryRules.ruleTypeDuplicates
          .map((row) => `${row.rule_type}(${row.duplicate_count})`).join(', ');
        throw new Error(`salary_rules.rule_type 存在重复值，请先人工处理：${summary}`);
      }
      const expectedNameExists = assertNamedIndexAvailable(
        indexes, 'uk_salary_rules_rule_type', ['rule_type'], true
      );
      const equivalentExists = [...indexes.values()]
        .some((rows) => isIndex(rows, ['rule_type'], true));
      if (!expectedNameExists && !equivalentExists) {
        plan.push(
          'ALTER TABLE `salary_rules` ADD UNIQUE INDEX ' +
          '`uk_salary_rules_rule_type` (`rule_type`)'
        );
      }
    }
  }

  if (!payrolls.exists) {
    plan.push(PAYROLLS_TABLE_SQL);
  } else {
    const columns = validateColumns('payrolls', payrolls, plan);
    const indexes = groupIndexes(payrolls.indexes);
    if (!isIndex(indexes.get('PRIMARY'), ['id'], true)) {
      throw new Error('payrolls 主键不是 id 单列主键，请人工处理');
    }

    if (['employee_id', 'year', 'month'].every((field) => columns.has(field))) {
      if (hasUniqueIndexWithPrefix(indexes, ['employee_id', 'year', 'month'])) {
        throw new Error(
          'payrolls 已存在以 employee_id/year/month 开头的唯一索引，' +
          '会阻止同月调整工资条，请人工处理'
        );
      }
      const expectedNameExists = assertNamedIndexAvailable(
        indexes,
        'idx_payrolls_employee_period',
        ['employee_id', 'year', 'month'],
        false
      );
      const equivalentExists = [...indexes.values()]
        .some((rows) => isIndex(rows, ['employee_id', 'year', 'month'], false));
      if (!expectedNameExists && !equivalentExists) {
        plan.push(
          'ALTER TABLE `payrolls` ADD INDEX `idx_payrolls_employee_period` ' +
          '(`employee_id`, `year`, `month`)'
        );
      }
    }

    if (columns.has('status')) {
      if (hasUniqueIndexWithPrefix(indexes, ['status'])) {
        throw new Error('payrolls.status 存在唯一索引，与普通状态索引预期冲突，请人工处理');
      }
      const expectedNameExists = assertNamedIndexAvailable(
        indexes, 'idx_payrolls_status', ['status'], false
      );
      const equivalentExists = [...indexes.values()]
        .some((rows) => isIndex(rows, ['status'], false));
      if (!expectedNameExists && !equivalentExists) {
        plan.push('ALTER TABLE `payrolls` ADD INDEX `idx_payrolls_status` (`status`)');
      }
    }
  }

  if (!patentInventory.exists) {
    throw new Error('patent_inventory 表不存在；本迁移不会推测性创建库存表，请先执行新库初始化或人工处理');
  }
  validateColumns('patent_inventory', patentInventory, plan);

  return plan;
}

async function inspectTable(sequelize, tableName) {
  const escapedLikeName = tableName.replace(/_/g, '\\_');
  const tableRows = normalizeQueryRows(
    await sequelize.query(`SHOW TABLES LIKE '${escapedLikeName}'`)
  ) || [];
  if (tableRows.length === 0) return { exists: false, columns: [], indexes: [], rowCount: 0 };

  const columns = normalizeQueryRows(
    await sequelize.query(`SHOW COLUMNS FROM \`${tableName}\``)
  ) || [];
  const indexes = normalizeQueryRows(
    await sequelize.query(`SHOW INDEX FROM \`${tableName}\``)
  ) || [];
  return { exists: true, columns, indexes, rowCount: 0 };
}

async function inspectPayrollSchema(sequelize) {
  // 所有 SHOW 探测均在任何可能的 DDL 之前完成。
  const snapshot = {};
  for (const tableName of ['salary_rules', 'payrolls', 'patent_inventory']) {
    snapshot[tableName] = await inspectTable(sequelize, tableName);
  }

  for (const tableName of ['salary_rules', 'payrolls']) {
    const table = snapshot[tableName];
    if (!table.exists) continue;
    const countRows = normalizeQueryRows(
      await sequelize.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``)
    ) || [];
    table.rowCount = Number(countRows[0] && countRows[0].row_count) || 0;
  }

  const salaryRules = snapshot.salary_rules;
  if (salaryRules.exists && salaryRules.columns.some((row) => row.Field === 'rule_type')) {
    salaryRules.ruleTypeDuplicates = normalizeQueryRows(await sequelize.query(`
      SELECT rule_type, COUNT(*) AS duplicate_count
      FROM \`salary_rules\`
      GROUP BY rule_type
      HAVING COUNT(*) > 1
      ORDER BY rule_type
      LIMIT 20
    `)) || [];
  }

  return snapshot;
}

async function ensurePayrollSchema(sequelize) {
  const snapshot = await inspectPayrollSchema(sequelize);
  const statements = buildPayrollSchemaMigrationPlan(snapshot);
  for (const sql of statements) await sequelize.query(sql);
  return { changed: statements.length > 0, statements };
}

async function run() {
  // dotenv 仅属于命令行迁移入口。只读启动门禁会复用本文件导出的
  // inspect/build 函数，不应在加载检查器时改写进程环境。
  require('dotenv').config();
  const { sequelize } = require('../src/config/database');
  try {
    await sequelize.authenticate();
    const result = await ensurePayrollSchema(sequelize);
    console.log(result.changed
      ? `✓ 薪酬结构迁移完成，共执行 ${result.statements.length} 条 DDL`
      : '✓ 薪酬结构已符合预期，无需修改');
  } catch (error) {
    console.error('薪酬结构迁移失败:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) run();

module.exports = {
  SALARY_RULES_TABLE_SQL,
  PAYROLLS_TABLE_SQL,
  COLUMN_SPECS,
  EXPECTED_PAYROLL_STATUS,
  normalizeQueryRows,
  normalizeType,
  enumValues,
  groupIndexes,
  isIndex,
  hasUniqueIndexWithPrefix,
  buildPayrollSchemaMigrationPlan,
  inspectPayrollSchema,
  ensurePayrollSchema
};
