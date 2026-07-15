'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const TEST_NAME_PATTERN = /(?:^|_)(?:test|ci|sandbox)(?:_|$)/i;

function normalizeTestDatabaseName(value) {
  const databaseName = String(value || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error('测试数据库名只能包含字母、数字和下划线');
  }
  if (!TEST_NAME_PATTERN.test(databaseName)) {
    throw new Error('测试数据库名必须包含独立的 test、ci 或 sandbox 标识');
  }
  if (['erp_db', 'patent_notice_system'].includes(databaseName.toLowerCase())) {
    throw new Error('拒绝初始化正式数据库名');
  }
  return databaseName;
}

function validateTestEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('初始化测试库必须显式设置 NODE_ENV=test');
  }
  if (env.ALLOW_TEST_DB_INIT !== 'YES') {
    throw new Error('初始化测试库必须显式设置 ALLOW_TEST_DB_INIT=YES');
  }
  return normalizeTestDatabaseName(env.DB_NAME);
}

function buildTestDatabaseSql(source, databaseName) {
  const safeName = normalizeTestDatabaseName(databaseName);
  const createPattern = /CREATE DATABASE IF NOT EXISTS\s+`?erp_db`?\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;/i;
  const usePattern = /USE\s+`?erp_db`?\s*;/i;
  if (!createPattern.test(source) || !usePattern.test(source)) {
    throw new Error('初始化 SQL 缺少预期的 erp_db CREATE/USE 语句');
  }
  return source
    .replace(
      createPattern,
      `CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    )
    .replace(usePattern, `USE \`${safeName}\`;`);
}

async function main() {
  const envPath = process.env.TEST_ENV_FILE
    ? path.resolve(process.env.TEST_ENV_FILE)
    : path.resolve(__dirname, '..', '.env.test');
  dotenv.config({ path: envPath });

  const databaseName = validateTestEnvironment(process.env);
  const source = fs.readFileSync(path.resolve(__dirname, 'init-database.sql'), 'utf8');
  const sql = buildTestDatabaseSql(source, databaseName);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });

  try {
    await connection.query(sql);
    console.log(`✓ 隔离测试数据库 ${databaseName} 初始化完成`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`✗ 测试数据库初始化失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizeTestDatabaseName,
  validateTestEnvironment,
  buildTestDatabaseSql,
  main
};
