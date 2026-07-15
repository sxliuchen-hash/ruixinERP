'use strict';

const fs = require('fs');
const path = require('path');

const {
  SALARY_RULES_TABLE_SQL,
  PAYROLLS_TABLE_SQL,
  COLUMN_SPECS,
  buildPayrollSchemaMigrationPlan,
  ensurePayrollSchema
} = require('../scripts/run-payroll-schema-migration');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readTable(sql, tableName) {
  const match = sql.match(new RegExp(
    'CREATE TABLE IF NOT EXISTS `' + tableName + '` \\(([\\s\\S]*?)\\) ENGINE=InnoDB',
    'i'
  ));
  if (!match) throw new Error(`init-database.sql 缺少 ${tableName} 表定义`);
  return match[1];
}

function column(field, type) {
  return { Field: field, Type: type, Null: 'YES', Key: '', Default: null, Extra: '' };
}

function indexRows(name, columns, unique = false) {
  return columns.map((field, index) => ({
    Key_name: name,
    Column_name: field,
    Seq_in_index: index + 1,
    Non_unique: unique ? 0 : 1
  }));
}

const TYPE_BY_FIELD = {
  id: 'int',
  rule_type: 'varchar(50)',
  rule_name: 'varchar(100)',
  rule_data: 'json',
  remark: 'text',
  create_time: 'datetime',
  update_time: 'datetime',
  employee_id: 'int',
  year: 'int',
  month: 'int',
  base_salary: 'decimal(10,2)',
  position_allowance: 'decimal(10,2)',
  attendance_bonus: 'decimal(10,2)',
  grade_allowance: 'decimal(10,2)',
  commission: 'decimal(10,2)',
  purchase_commission: 'decimal(10,2)',
  bonus: 'decimal(10,2)',
  social_insurance: 'decimal(10,2)',
  income_tax: 'decimal(10,2)',
  leave_days: 'decimal(4,1)',
  personal_leave_days: 'decimal(4,1)',
  sick_leave_days: 'decimal(4,1)',
  leave_deduction: 'decimal(10,2)',
  other_deduction: 'decimal(10,2)',
  gross_income: 'decimal(10,2)',
  total_deduction: 'decimal(10,2)',
  net_salary: 'decimal(10,2)',
  monthly_profit: 'decimal(12,2)',
  contract_count: 'int',
  status: "enum('draft','confirmed','paid','voided')",
  is_adjustment: 'tinyint(1)',
  adjust_source_id: 'int',
  voided_reason: 'varchar(255)',
  confirmed_by: 'int',
  confirmed_at: 'datetime',
  purchaser_id: 'int'
};

function completeColumns(tableName) {
  return Object.keys(COLUMN_SPECS[tableName])
    .map((field) => column(field, TYPE_BY_FIELD[field]));
}

function completeSnapshot() {
  return {
    salary_rules: {
      exists: true,
      rowCount: 2,
      columns: completeColumns('salary_rules'),
      indexes: [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('uk_salary_rules_rule_type', ['rule_type'], true)
      ],
      ruleTypeDuplicates: []
    },
    payrolls: {
      exists: true,
      rowCount: 2,
      columns: completeColumns('payrolls'),
      indexes: [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('idx_payrolls_employee_period', ['employee_id', 'year', 'month']),
        ...indexRows('idx_payrolls_status', ['status'])
      ]
    },
    patent_inventory: {
      exists: true,
      columns: completeColumns('patent_inventory'),
      indexes: []
    }
  };
}

describe('薪酬显式结构迁移', () => {
  test('新库 SQL 完整覆盖 SalaryRule、Payroll 模型字段并包含 purchaser_id', () => {
    const initSql = fs.readFileSync(
      path.join(REPO_ROOT, 'backend', 'scripts', 'init-database.sql'),
      'utf8'
    );
    const salaryRulesSql = readTable(initSql, 'salary_rules');
    const payrollsSql = readTable(initSql, 'payrolls');
    const patentInventorySql = readTable(initSql, 'patent_inventory');
    const SalaryRule = require('../src/models/SalaryRule');
    const Payroll = require('../src/models/Payroll');

    for (const field of Object.keys(SalaryRule.rawAttributes)) {
      expect(salaryRulesSql).toContain(`\`${field}\``);
    }
    for (const field of Object.keys(Payroll.rawAttributes)) {
      expect(payrollsSql).toContain(`\`${field}\``);
    }

    expect(salaryRulesSql).toContain(
      'UNIQUE KEY `uk_salary_rules_rule_type` (`rule_type`)'
    );
    expect(payrollsSql).toContain(
      'KEY `idx_payrolls_employee_period` (`employee_id`, `year`, `month`)'
    );
    expect(payrollsSql).toContain('KEY `idx_payrolls_status` (`status`)');
    expect(payrollsSql).toContain("ENUM('draft','confirmed','paid','voided')");
    expect(patentInventorySql).toContain('`purchaser_id` INT DEFAULT NULL');
  });

  test('缺失薪酬表使用确定 CREATE TABLE，库存仅补 purchaser_id', () => {
    const plan = buildPayrollSchemaMigrationPlan({
      salary_rules: { exists: false },
      payrolls: { exists: false },
      patent_inventory: { exists: true, columns: [], indexes: [] }
    });

    expect(plan).toEqual([
      SALARY_RULES_TABLE_SQL,
      PAYROLLS_TABLE_SQL,
      expect.stringContaining(
        'ALTER TABLE `patent_inventory` ADD COLUMN `purchaser_id` INT DEFAULT NULL'
      )
    ]);
  });

  test('完整结构的 SQL 计划为空，重复执行保持幂等', () => {
    expect(buildPayrollSchemaMigrationPlan(completeSnapshot())).toEqual([]);
    expect(buildPayrollSchemaMigrationPlan(completeSnapshot())).toEqual([]);
  });

  test('已有 payrolls 只补缺列、扩展 voided 并补普通索引', () => {
    const snapshot = completeSnapshot();
    snapshot.payrolls.columns = snapshot.payrolls.columns.filter((row) =>
      !['purchase_commission', 'income_tax', 'purchaser_id'].includes(row.Field)
    );
    snapshot.payrolls.columns.find((row) => row.Field === 'status').Type =
      "enum('draft','confirmed','paid')";
    snapshot.payrolls.indexes = indexRows('PRIMARY', ['id'], true);

    const plan = buildPayrollSchemaMigrationPlan(snapshot);
    const joined = plan.join('\n');
    expect(joined).toContain(
      'ALTER TABLE `payrolls` ADD COLUMN `purchase_commission` DECIMAL(10,2) DEFAULT 0.00'
    );
    expect(joined).toContain(
      'ALTER TABLE `payrolls` ADD COLUMN `income_tax` DECIMAL(10,2) DEFAULT 0.00'
    );
    expect(joined).toContain(
      "MODIFY COLUMN `status` ENUM('draft','confirmed','paid','voided')"
    );
    expect(joined).toContain(
      'ADD INDEX `idx_payrolls_employee_period` (`employee_id`, `year`, `month`)'
    );
    expect(joined).toContain('ADD INDEX `idx_payrolls_status` (`status`)');
  });

  test('执行前先完成 SHOW TABLES/COLUMNS/INDEX 探测且脚本不调用 sync/alter', async () => {
    const calls = [];
    const sequelize = {
      query: jest.fn(async (sql) => {
        calls.push(sql);
        if (sql.startsWith("SHOW TABLES LIKE 'salary\\_rules'")) return [[], {}];
        if (sql.startsWith("SHOW TABLES LIKE 'payrolls'")) return [[], {}];
        if (sql.startsWith("SHOW TABLES LIKE 'patent\\_inventory'")) return [[{ table: 'patent_inventory' }], {}];
        if (sql.startsWith('SHOW COLUMNS FROM `patent_inventory`')) {
          return [[column('purchaser_id', 'int')], {}];
        }
        if (sql.startsWith('SHOW INDEX FROM `patent_inventory`')) return [[], {}];
        return [[], {}];
      })
    };

    await ensurePayrollSchema(sequelize);
    const firstDdl = calls.findIndex((sql) => /^(?:CREATE|ALTER) TABLE/.test(sql));
    const lastShow = calls.reduce(
      (last, sql, index) => sql.startsWith('SHOW ') ? index : last,
      -1
    );
    expect(firstDdl).toBeGreaterThan(lastShow);

    const migrationSource = fs.readFileSync(
      path.join(REPO_ROOT, 'backend', 'scripts', 'run-payroll-schema-migration.js'),
      'utf8'
    );
    expect(migrationSource).not.toMatch(/\.sync\s*\(|alter\s*:\s*true/i);
    const appSource = fs.readFileSync(
      path.join(REPO_ROOT, 'backend', 'src', 'app.js'),
      'utf8'
    );
    expect(appSource).not.toContain('run-payroll-schema-migration');
  });

  test('所有自动 DDL 都不包含 DROP/TRUNCATE/RENAME', () => {
    const snapshot = completeSnapshot();
    snapshot.payrolls.columns = snapshot.payrolls.columns.filter((row) =>
      row.Field !== 'income_tax'
    );
    snapshot.payrolls.columns.find((row) => row.Field === 'status').Type =
      "enum('draft','confirmed','paid')";
    snapshot.payrolls.indexes = indexRows('PRIMARY', ['id'], true);
    const allSql = [
      SALARY_RULES_TABLE_SQL,
      PAYROLLS_TABLE_SQL,
      ...buildPayrollSchemaMigrationPlan(snapshot)
    ].join('\n');
    expect(allSql).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/i);
  });

  test.each([
    ['列类型冲突', (snapshot) => {
      snapshot.payrolls.columns.find((row) => row.Field === 'net_salary').Type = 'varchar(50)';
    }, /类型.*严重冲突/],
    ['status 含未知枚举', (snapshot) => {
      snapshot.payrolls.columns.find((row) => row.Field === 'status').Type =
        "enum('draft','confirmed','paid','deleted')";
    }, /status ENUM 值.*严重冲突/],
    ['同名索引定义错误', (snapshot) => {
      snapshot.payrolls.indexes = [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('idx_payrolls_status', ['employee_id'])
      ];
    }, /索引 idx_payrolls_status.*不符合预期/],
    ['遗留年月唯一索引', (snapshot) => {
      snapshot.payrolls.indexes = [
        ...indexRows('PRIMARY', ['id'], true),
        ...indexRows('legacy_unique_period', ['employee_id', 'year', 'month'], true),
        ...indexRows('idx_payrolls_status', ['status'])
      ];
    }, /唯一索引.*调整工资条/],
    ['规则类型重复', (snapshot) => {
      snapshot.salary_rules.ruleTypeDuplicates = [
        { rule_type: 'commission', duplicate_count: 2 }
      ];
    }, /rule_type 存在重复值/],
    ['非空旧表缺核心列', (snapshot) => {
      snapshot.payrolls.columns = snapshot.payrolls.columns.filter(
        (row) => row.Field !== 'employee_id'
      );
    }, /缺失且表内已有数据/]
  ])('%s 时 fail-closed，不生成破坏性修复', (_name, mutate, expected) => {
    const snapshot = completeSnapshot();
    mutate(snapshot);
    expect(() => buildPayrollSchemaMigrationPlan(snapshot)).toThrow(expected);
  });
});
