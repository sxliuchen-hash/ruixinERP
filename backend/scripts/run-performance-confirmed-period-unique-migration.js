'use strict';

require('dotenv').config();

const {
  GENERATED_COLUMN,
  INDEX_NAME,
  normalizeQueryRows,
  isExpectedGeneratedColumn,
  isExpectedUniqueIndex,
  readPerformanceImportConstraint
} = require('../src/services/performanceImportIndexGuard');

const GENERATED_COLUMN_SQL =
  `\`${GENERATED_COLUMN}\` VARCHAR(16) GENERATED ALWAYS AS (` +
  "CASE WHEN `status` = 'confirmed' " +
  "THEN CONCAT(`year`, '-', LPAD(`month`, 2, '0')) ELSE NULL END" +
  ") STORED COMMENT '仅已确认批次的年月唯一键'";

async function ensurePerformanceConfirmedPeriodUnique(sequelize) {
  // 必须在任何 DDL 前检查历史重复；发现冲突只报错，不自动删除或合并业务数据。
  const duplicateResult = await sequelize.query(`
    SELECT year, month, COUNT(*) AS duplicate_count
    FROM performance_imports
    WHERE status = 'confirmed'
    GROUP BY year, month
    HAVING COUNT(*) > 1
    ORDER BY year, month
    LIMIT 20
  `);
  const duplicates = normalizeQueryRows(duplicateResult) || [];
  if (duplicates.length > 0) {
    const summary = duplicates
      .map((row) => `${row.year}-${String(row.month).padStart(2, '0')}(${row.duplicate_count})`)
      .join(', ');
    throw new Error(
      `performance_imports 存在重复的已确认年月批次，无法创建唯一约束。` +
      `请先人工核对并处理：${summary}`
    );
  }

  const { columnRows, indexRows } = await readPerformanceImportConstraint(sequelize);
  if (columnRows.length > 0 && !isExpectedGeneratedColumn(columnRows)) {
    throw new Error(`${GENERATED_COLUMN} 已存在但生成表达式或类型不符合预期，请人工检查`);
  }
  if (indexRows.length > 0 && !isExpectedUniqueIndex(indexRows)) {
    throw new Error(`${INDEX_NAME} 已存在但不是 ${GENERATED_COLUMN} 单列唯一索引，请人工检查`);
  }
  if (indexRows.length > 0 && columnRows.length === 0) {
    throw new Error(`${INDEX_NAME} 已存在但生成列 ${GENERATED_COLUMN} 缺失，请人工检查`);
  }

  const columnExists = columnRows.length === 1;
  const indexExists = indexRows.length === 1;
  if (!columnExists && !indexExists) {
    await sequelize.query(
      `ALTER TABLE \`performance_imports\` ` +
      `ADD COLUMN ${GENERATED_COLUMN_SQL}, ` +
      `ADD UNIQUE INDEX \`${INDEX_NAME}\` (\`${GENERATED_COLUMN}\`)`
    );
  } else if (!indexExists) {
    await sequelize.query(
      `ALTER TABLE \`performance_imports\` ` +
      `ADD UNIQUE INDEX \`${INDEX_NAME}\` (\`${GENERATED_COLUMN}\`)`
    );
  }

  return {
    columnCreated: !columnExists,
    indexCreated: !indexExists,
    columnName: GENERATED_COLUMN,
    indexName: INDEX_NAME
  };
}

async function run() {
  const { sequelize } = require('../src/config/database');
  try {
    await sequelize.authenticate();
    const result = await ensurePerformanceConfirmedPeriodUnique(sequelize);
    console.log(result.indexCreated
      ? `✓ 已创建业绩已确认年月唯一约束 ${result.indexName}`
      : `✓ 业绩已确认年月唯一约束 ${result.indexName} 已存在，无需修改`);
  } catch (error) {
    console.error('业绩已确认年月唯一约束迁移失败:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  GENERATED_COLUMN_SQL,
  ensurePerformanceConfirmedPeriodUnique
};
