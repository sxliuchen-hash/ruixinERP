/**
 * 为 employees.user_id 增加唯一索引。
 *
 * 安全约束：
 * - 迁移前显式检查重复的非空 user_id；发现重复时失败，不修改或删除业务数据。
 * - 已存在正确索引时可重复执行。
 * - 同名索引定义不正确时失败，避免误判为迁移完成。
 */
'use strict';

require('dotenv').config();

const INDEX_NAME = 'uk_employees_user_id';

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

async function ensureEmployeeUserIdUnique(sequelize) {
  const duplicateResult = await sequelize.query(`
    SELECT user_id, COUNT(*) AS binding_count
    FROM employees
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
    ORDER BY user_id
    LIMIT 20
  `);
  const duplicates = normalizeQueryRows(duplicateResult) || [];

  if (duplicates.length > 0) {
    const summary = duplicates
      .map((row) => `${row.user_id}(${row.binding_count})`)
      .join(', ');
    throw new Error(
      `employees.user_id 存在重复绑定，无法创建唯一索引。请先人工处理：${summary}`
    );
  }

  const indexResult = await sequelize.query(
    `SHOW INDEX FROM employees WHERE Key_name = '${INDEX_NAME}'`
  );
  const indexRows = normalizeQueryRows(indexResult) || [];

  if (indexRows.length > 0) {
    const isCorrectIndex = indexRows.length === 1 &&
      Number(indexRows[0].Non_unique) === 0 &&
      indexRows[0].Column_name === 'user_id';

    if (!isCorrectIndex) {
      throw new Error(
        `employees 已存在同名索引 ${INDEX_NAME}，但不是 user_id 单列唯一索引，请人工检查`
      );
    }
    return { created: false, indexName: INDEX_NAME };
  }

  await sequelize.query(
    `ALTER TABLE employees ADD UNIQUE INDEX ${INDEX_NAME} (user_id)`
  );
  return { created: true, indexName: INDEX_NAME };
}

async function run() {
  const { sequelize } = require('../src/config/database');

  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
    const result = await ensureEmployeeUserIdUnique(sequelize);
    console.log(result.created
      ? `✓ 已创建唯一索引 ${result.indexName}`
      : `✓ 唯一索引 ${result.indexName} 已存在，无需修改`);
  } catch (error) {
    console.error('迁移失败:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  INDEX_NAME,
  ensureEmployeeUserIdUnique,
  normalizeQueryRows
};
