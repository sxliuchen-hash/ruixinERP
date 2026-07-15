'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASH_EXECUTABLE = process.platform === 'win32'
  ? [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
  ].find((candidate) => fs.existsSync(candidate)) || 'bash'
  : 'bash';

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
}

function readTable(sql, tableName) {
  const pattern = new RegExp(
    'CREATE TABLE IF NOT EXISTS `' + tableName + '` \\(([\\s\\S]*?)\\) ENGINE=InnoDB',
    'i'
  );
  const match = sql.match(pattern);
  if (!match) throw new Error(`init-database.sql 缺少 ${tableName} 表定义`);
  return match[1];
}

function readWorkflowJob(source, jobName) {
  const normalized = source.replace(/\r\n/g, '\n');
  const marker = `\n  ${jobName}:\n`;
  const start = normalized.indexOf(marker);
  if (start === -1) throw new Error(`CI workflow 缺少 ${jobName} job`);
  const bodyStart = start + marker.length;
  const remaining = normalized.slice(bodyStart);
  const nextJob = remaining.search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return nextJob === -1 ? remaining : remaining.slice(0, nextJob);
}

describe('数据库初始化、迁移、启动门禁和部署入口契约', () => {
  const initSql = readRepoFile('backend', 'scripts', 'init-database.sql');

  test('新库初始化结构与运行时模型/迁移约束一致', () => {
    const employees = readTable(initSql, 'employees');
    const contracts = readTable(initSql, 'contracts');
    const payments = readTable(initSql, 'payments');
    const expenses = readTable(initSql, 'expenses');
    const performanceImports = readTable(initSql, 'performance_imports');
    const systemSettings = readTable(initSql, 'system_settings');

    expect(employees).toContain('UNIQUE KEY `uk_employees_user_id` (`user_id`)');
    expect(contracts).toContain('UNIQUE KEY `uk_contracts_sp_no` (`sp_no`)');
    expect(payments).toContain('UNIQUE KEY `uk_payments_sp_no` (`sp_no`)');
    expect(expenses).toContain('UNIQUE KEY `uk_expenses_sp_no` (`sp_no`)');
    expect(performanceImports).toContain(
      'UNIQUE KEY `uk_performance_imports_confirmed_period` (`confirmed_period_key`)'
    );
    expect(performanceImports).toMatch(
      /`confirmed_period_key` VARCHAR\(16\) GENERATED ALWAYS AS[\s\S]*status[\s\S]*confirmed[\s\S]*ELSE NULL[\s\S]*STORED/
    );

    expect(payments).toMatch(/`account_id` INT DEFAULT NULL/);
    expect(payments).not.toMatch(/`account_id` INT NOT NULL/);
    expect(expenses).toMatch(/`user_id` INT DEFAULT NULL/);
    expect(expenses).not.toMatch(/`user_id` INT NOT NULL/);
    expect(payments).not.toContain('KEY `idx_sp_no` (`sp_no`)');
    expect(expenses).not.toContain('KEY `idx_sp_no` (`sp_no`)');
    expect(systemSettings).toContain('`setting_value` JSON NOT NULL');
    expect(systemSettings).toContain("`category` VARCHAR(50) DEFAULT 'general'");
    expect(systemSettings).toContain('UNIQUE KEY `uk_setting_key` (`setting_key`)');
    expect(systemSettings).toContain('KEY `idx_category` (`category`)');
    expect(initSql).toMatch(
      /INSERT INTO `system_settings`[\s\S]*'channel_sales_cost'[\s\S]*"default": 500/
    );
  });

  test('CI 只在临时 MySQL service 的 erp_ci_test 中运行数据库集成测试', () => {
    const workflow = readRepoFile('.github', 'workflows', 'ci.yml');
    const packageJson = JSON.parse(readRepoFile('backend', 'package.json'));
    const job = readWorkflowJob(workflow, 'database-integration');

    expect(job).toContain(
      'image: mysql:8.4@sha256:c831a0f11348d402b43d77453e17d770be2eef356615a2823fe0f5a0d6c8b9af'
    );
    expect(job).not.toMatch(/image:\s+mysql:8\.4\s*(?:\r?\n|$)/);
    expect(job).toContain('MYSQL_ALLOW_EMPTY_PASSWORD: "yes"');
    expect(job).toContain('MYSQL_ROOT_HOST: "%"');
    expect(job).toContain('MYSQL_DATABASE: erp_ci_test');
    expect(job).toContain('NODE_ENV: test');
    expect(job).toContain('RUN_DB_TESTS: "1"');
    expect(job).toContain('ALLOW_TEST_DB_INIT: "YES"');
    expect(job).toContain('DB_HOST: 127.0.0.1');
    expect(job).toContain('DB_NAME: erp_ci_test');
    expect(job).toContain('DB_USER: root');
    expect(job).toContain('DB_PASSWORD: ""');
    expect(job).toContain(
      '--health-cmd="mysqladmin ping --host=127.0.0.1 --user=root --silent"'
    );

    const initialize = job.indexOf('npm run init:test-db');
    const revokeInit = job.indexOf('ALLOW_TEST_DB_INIT: "NO"');
    const integration = job.indexOf('npm run test:integration:ci');
    expect(initialize).toBeGreaterThan(-1);
    expect(revokeInit).toBeGreaterThan(initialize);
    expect(integration).toBeGreaterThan(revokeInit);
    expect(job).not.toMatch(/erp_db|patent_notice_system|MAIN_DB_|secrets\./);

    expect(packageJson.scripts['test:integration:ci']).toBe(
      'jest --ci --runInBand --detectOpenHandles --forceExit=false tests/integration'
    );
    expect(packageJson.scripts['migrate:payroll-schema']).toBe(
      'node scripts/run-payroll-schema-migration.js'
    );
    expect(packageJson.scripts['migrate:system-settings']).toBe(
      'node scripts/run-system-settings-migration.js'
    );
    expect((job.match(/npm run migrate:payroll-schema/g) || [])).toHaveLength(2);
    expect((job.match(/npm run migrate:system-settings/g) || [])).toHaveLength(2);
  });

  test('可提交生产模板覆盖 R7 SSO，真实 .env.production 被忽略且所有 env 模板无 literal Secret', () => {
    const envProduction = readRepoFile('backend', '.env.production.example');
    const backendIgnore = readRepoFile('backend', '.gitignore');

    for (const key of [
      'ENABLE_PASSWORD_LOGIN',
      'ENABLE_SSO_LOGIN',
      'ENABLE_LEGACY_SESSION',
      'UNIFIED_AUTH_PREFLIGHT_CHECK_DB',
      'UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS',
      'MAIN_SYSTEM_URL',
      'MAIN_SSO_BASE_URL',
      'ERP_SSO_CALLBACK_URL_PRODUCTION',
      'ERP_SSO_STATE_TTL_SEC',
      'ERP_SSO_STATE_COOKIE_NAME',
      'ERP_SSO_CLIENT_ID',
      'ERP_SSO_CLIENT_SECRET',
      'ERP_SSO_ACTIVE_KID',
      'ERP_SSO_ACTIVE_PUBLIC_KEY_PATH',
      'ERP_SESSION_SECRET',
      'MAIN_API_CLIENT_ID',
      'MAIN_API_CLIENT_SECRET',
      'ERP_MANIFEST_CLIENT_ID',
      'ERP_MANIFEST_CLIENT_SECRET',
      'ERP_PROVISION_CLIENT_ID',
      'ERP_PROVISION_CLIENT_SECRET',
      'WECHAT_TEMPLATE_CONTRACT',
      'WECHAT_TEMPLATE_PAYMENT',
      'WECHAT_TEMPLATE_EXPENSE',
      'DB_BACKUP_NAME',
      'DB_BACKUP_USER',
      'DB_BACKUP_PASSWORD',
      'ALLOW_DB_RESTORE_SMOKE',
      'DB_RESTORE_MYSQL_IMAGE',
      'COS_BACKUP_SECRET_ID',
      'COS_BACKUP_SECRET_KEY',
      'COS_BACKUP_BUCKET',
      'COS_BACKUP_REGION'
    ]) {
      expect(envProduction).toMatch(new RegExp(`^${key}=`, 'm'));
    }

    expect(envProduction).toContain('ENABLE_SSO_LOGIN=false');
    expect(envProduction).toContain('ERP_SSO_ALLOW_LEGACY_NO_KID=false');
    expect(envProduction).toContain(
      'ERP_SSO_CALLBACK_URL_PRODUCTION=https://erp.iptt.top/sso/callback'
    );
    expect(envProduction).toContain('IP_AUTH_MODE=client_credentials');
    expect(envProduction).toContain('CORS_ORIGIN=https://erp.iptt.top');
    expect(envProduction).not.toContain('JWT（与主项目共享同一 Secret）');

    const values = Object.fromEntries(
      envProduction
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
        .filter(Boolean)
        .map((match) => [match[1], match[2]])
    );
    const safeTemplateValue = /^(?:|your_[A-Za-z0-9_]*|replace_with_[A-Za-z0-9_]*|change_me|placeholder|example|<[^>]+>|\*+|x+)$/i;
    for (const key of [
      'DB_PASSWORD',
      'MAIN_DB_PASSWORD',
      'REDIS_PASSWORD',
      'JWT_SECRET',
      'WECHAT_SECRET',
      'WECHAT_TOKEN',
      'WECHAT_AES_KEY',
      'ERP_SSO_CLIENT_SECRET',
      'ERP_SESSION_SECRET',
      'MAIN_API_CLIENT_SECRET',
      'ERP_MANIFEST_CLIENT_SECRET',
      'ERP_PROVISION_CLIENT_SECRET',
      'IP_API_CLIENT_SECRET',
      'DB_BACKUP_PASSWORD',
      'COS_BACKUP_SECRET_ID',
      'COS_BACKUP_SECRET_KEY'
    ]) {
      expect(values[key] || '').toMatch(safeTemplateValue);
    }

    expect(backendIgnore).toMatch(/^\.env\.production$/m);

    const envFiles = execFileSync(
      'git',
      [
        'ls-files', '--cached', '--others', '--exclude-standard', '--',
        ':(glob)**/.env*'
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((relativePath) => fs.existsSync(path.join(REPO_ROOT, relativePath)));

    expect(envFiles).toContain('backend/.env.production.example');
    for (const relativePath of envFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || !/(?:_SECRET|_PASSWORD|_TOKEN|_AES_KEY|_PRIVATE_KEY|SECRET_ID|SECRET_KEY)$/.test(match[1])) continue;
        expect(match[2]).toMatch(safeTemplateValue);
      }
    }
  });

  test.each([
    ['backend/scripts/deploy.sh', ['backend', 'scripts', 'deploy.sh']],
    ['deploy/deploy.sh', ['deploy', 'deploy.sh']]
  ])('%s 无条件拒绝执行，且退出前没有生产动作', (_label, segments) => {
    const source = readRepoFile(...segments).replace(/\r\n/g, '\n');
    const scriptPath = path.join(REPO_ROOT, ...segments);
    expect(source).toContain('历史一键部署入口已禁用（fail-closed）');
    expect(source).toContain('docs/部署运维手册.md');
    expect(source).toContain('未执行任何拉取、迁移、构建、重启或流量切换操作');
    expect(source).toMatch(/\nexit 78\n?$/);
    expect(source.match(/\bexit\s+/g)).toHaveLength(1);

    expect(source).not.toMatch(/\$(?:\{|)(?:[1-9@*#-])|getopts|\bcase\b/);
    expect(source).not.toMatch(
      /\b(?:git|npm|npx|node|mysql|mysqldump|docker|pm2|nginx|systemctl|curl|wget|rsync|sudo)\b/
    );
    expect(source).not.toMatch(/(?:^|[;&|]\s*)(?:rm|cp|mv|ln|chmod|chown)\s/m);
    expect(source).not.toMatch(
      /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i
    );

    for (const args of [[], ['--init-db'], ['--force', 'unexpected-value']]) {
      const result = spawnSync(BASH_EXECUTABLE, [scriptPath, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(78);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('历史一键部署入口已禁用');
      expect(result.stderr).toContain('docs/部署运维手册.md');
    }
  });

  test('启动门禁检查同一组索引、薪酬显式迁移和 payments.account_id nullable', () => {
    const databaseConfig = readRepoFile('backend', 'src', 'config', 'database.js');
    const preflight = readRepoFile(
      'backend', 'src', 'services', 'unifiedAuthPreflightService.js'
    );
    const employeeGuard = readRepoFile(
      'backend', 'src', 'services', 'employeeIndexGuard.js'
    );
    const wechatGuard = readRepoFile(
      'backend', 'src', 'services', 'wechatSpNoIndexGuard.js'
    );
    const migration = readRepoFile(
      'backend', 'scripts', 'run-wechat-sp-no-unique-migration.js'
    );
    const performanceGuard = readRepoFile(
      'backend', 'src', 'services', 'performanceImportIndexGuard.js'
    );
    const performanceMigration = readRepoFile(
      'backend', 'scripts', 'run-performance-confirmed-period-unique-migration.js'
    );
    const payrollGuard = readRepoFile(
      'backend', 'src', 'services', 'payrollSchemaGuard.js'
    );

    expect(databaseConfig).toContain(
      'employeeIndexCheck = assertEmployeeUserIdUniqueIndex'
    );
    expect(databaseConfig).toContain(
      'wechatIndexCheck = assertWechatSpNoUniqueIndexes'
    );
    expect(databaseConfig).toContain('await employeeIndexCheck(database)');
    expect(databaseConfig).toContain('await wechatIndexCheck(database)');
    expect(databaseConfig).toContain(
      'performanceIndexCheck = assertPerformanceImportConfirmedPeriodUniqueIndex'
    );
    expect(databaseConfig).toContain('await performanceIndexCheck(database)');
    expect(databaseConfig).toContain(
      'payrollSchemaCheck = assertPayrollSchemaReady'
    );
    expect(databaseConfig).toContain('await payrollSchemaCheck(database)');
    expect(preflight).toContain('assertEmployeeUserIdUniqueIndex(database)');
    expect(preflight).toContain('assertWechatSpNoUniqueIndexes(database)');
    expect(preflight).toContain(
      'assertPerformanceImportConfirmedPeriodUniqueIndex(database)'
    );
    expect(preflight).toContain('payrollSchemaCheck = defaultPayrollSchemaCheck');
    expect(preflight).toContain('await payrollSchemaCheck(database)');
    expect(preflight).toContain('withDefaultDatabaseConnection(runDatabaseChecks)');
    expect(payrollGuard).toContain('inspectPayrollSchema');
    expect(payrollGuard).toContain('buildPayrollSchemaMigrationPlan');
    expect(payrollGuard).not.toContain('ensurePayrollSchema');
    expect(employeeGuard).toContain("const INDEX_NAME = 'uk_employees_user_id'");

    for (const indexName of [
      'uk_contracts_sp_no',
      'uk_payments_sp_no',
      'uk_expenses_sp_no'
    ]) {
      expect(wechatGuard).toContain(indexName);
    }
    expect(migration).toContain('INDEX_SPECS');
    expect(migration).toContain('ADD UNIQUE INDEX ${spec.indexName} (${spec.column})');
    expect(wechatGuard).toContain("SHOW COLUMNS FROM payments WHERE Field = 'account_id'");
    expect(migration).toContain('ALTER TABLE payments MODIFY COLUMN account_id INT NULL');
    expect(migration).toContain('HAVING COUNT(*) > 1');
    expect(migration).toContain("TRIM(${spec.column}) = ''");
    expect(performanceGuard).toContain('uk_performance_imports_confirmed_period');
    expect(performanceMigration).toContain("WHERE status = 'confirmed'");
    expect(performanceMigration).toContain('HAVING COUNT(*) > 1');
    expect(performanceMigration).toContain('GENERATED ALWAYS AS');
    expect(performanceMigration).toContain('ADD UNIQUE INDEX');
  });

  test('Sequelize sync/alter 仅允许本地开发，生产环境必须 fail-closed', () => {
    const syncScript = readRepoFile('backend', 'scripts', 'sync-tables.js');

    expect(syncScript).toContain('SEQUELIZE_SCHEMA_SYNC_PRODUCTION_FORBIDDEN');
    expect(syncScript).toContain("String(env.NODE_ENV || '').trim().toLowerCase() === 'production'");
    expect(syncScript).toContain('assertDevelopmentOnly();');
    expect(syncScript).toContain('Payroll.sync({ alter: true })');
    expect(syncScript).toContain('PatentInventory.sync({ alter: true })');
  });
});
