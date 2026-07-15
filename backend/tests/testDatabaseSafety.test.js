'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeTestDatabaseName,
  validateTestEnvironment,
  buildTestDatabaseSql
} = require('../scripts/init-test-database');

describe('隔离测试数据库初始化安全门禁', () => {
  test.each(['erp_test', 'erp_ci', 'erp_sandbox_01'])(
    '接受明确隔离的数据库名 %s',
    (databaseName) => {
      expect(normalizeTestDatabaseName(databaseName)).toBe(databaseName);
    }
  );

  test.each(['', 'erp_db', 'patent_notice_system', 'erp_prod', '../erp_test', 'erp-test'])(
    '拒绝非隔离或非法数据库名 %s',
    (databaseName) => {
      expect(() => normalizeTestDatabaseName(databaseName)).toThrow();
    }
  );

  test('必须同时显式确认 test 环境和初始化授权', () => {
    expect(() => validateTestEnvironment({
      NODE_ENV: 'production',
      ALLOW_TEST_DB_INIT: 'YES',
      DB_NAME: 'erp_test'
    })).toThrow('NODE_ENV=test');
    expect(() => validateTestEnvironment({
      NODE_ENV: 'test',
      ALLOW_TEST_DB_INIT: 'NO',
      DB_NAME: 'erp_test'
    })).toThrow('ALLOW_TEST_DB_INIT=YES');
    expect(validateTestEnvironment({
      NODE_ENV: 'test',
      ALLOW_TEST_DB_INIT: 'YES',
      DB_NAME: 'erp_test'
    })).toBe('erp_test');
  });

  test('只把固定 erp_db 初始化目标替换为已验证的测试库', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'init-database.sql'),
      'utf8'
    );
    const sql = buildTestDatabaseSql(source, 'erp_test');

    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS `erp_test`');
    expect(sql).toContain('USE `erp_test`;');
    expect(sql).not.toMatch(/USE\s+`?erp_db`?\s*;/i);
  });
});
