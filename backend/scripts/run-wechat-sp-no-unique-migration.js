'use strict';

require('dotenv').config();

const {
  INDEX_SPECS,
  normalizeQueryRows
} = require('../src/services/wechatSpNoIndexGuard');

async function ensureWechatSpNoUniqueIndexes(sequelize) {
  const duplicateProblems = [];
  const blankProblems = [];
  const indexStatus = [];

  // 先完成所有只读检查，避免发现后续表异常时留下部分迁移结果。
  for (const spec of INDEX_SPECS) {
    const duplicateResult = await sequelize.query(`
      SELECT ${spec.column}, COUNT(*) AS duplicate_count
      FROM ${spec.table}
      WHERE ${spec.column} IS NOT NULL
      GROUP BY ${spec.column}
      HAVING COUNT(*) > 1
      ORDER BY ${spec.column}
      LIMIT 20
    `);
    const duplicates = normalizeQueryRows(duplicateResult) || [];
    if (duplicates.length > 0) {
      duplicateProblems.push({ spec, duplicates });
    }

    const blankResult = await sequelize.query(`
      SELECT COUNT(*) AS blank_count
      FROM ${spec.table}
      WHERE ${spec.column} IS NOT NULL AND TRIM(${spec.column}) = ''
    `);
    const blankRows = normalizeQueryRows(blankResult) || [];
    const blankCount = Number(blankRows[0]?.blank_count || 0);
    if (blankCount > 0) blankProblems.push({ spec, blankCount });

    const indexResult = await sequelize.query(
      `SHOW INDEX FROM ${spec.table} WHERE Key_name = '${spec.indexName}'`
    );
    const rows = normalizeQueryRows(indexResult) || [];
    if (rows.length > 0) {
      const isCorrect = rows.length === 1 &&
        Number(rows[0].Non_unique) === 0 &&
        rows[0].Column_name === spec.column;
      if (!isCorrect) {
        throw new Error(
          `${spec.table} 已存在同名索引 ${spec.indexName}，但不是 ${spec.column} 单列唯一索引`
        );
      }
    }
    indexStatus.push({ spec, exists: rows.length > 0 });
  }

  const accountColumnResult = await sequelize.query(
    "SHOW COLUMNS FROM payments WHERE Field = 'account_id'"
  );
  const accountColumnRows = normalizeQueryRows(accountColumnResult) || [];
  if (accountColumnRows.length !== 1) {
    throw new Error('payments.account_id 字段不存在，无法启用企微 pending 付款');
  }
  const accountColumnNullable = accountColumnRows[0].Null === 'YES';

  if (duplicateProblems.length > 0 || blankProblems.length > 0) {
    const duplicateSummary = duplicateProblems.map(({ spec, duplicates }) => (
      `${spec.table}: ${duplicates.map((row) => (
        `${row[spec.column]}(${row.duplicate_count})`
      )).join(', ')}`
    ));
    const blankSummary = blankProblems.map(({ spec, blankCount }) => (
      `${spec.table}: 空白 sp_no(${blankCount})`
    ));
    throw new Error(
      '存在重复或空白企微审批单号，无法创建唯一索引。' +
      `请先人工核对并处理：${[...duplicateSummary, ...blankSummary].join('; ')}`
    );
  }

  const created = [];
  for (const { spec, exists } of indexStatus) {
    if (exists) continue;
    await sequelize.query(
      `ALTER TABLE ${spec.table} ADD UNIQUE INDEX ${spec.indexName} (${spec.column})`
    );
    created.push(spec.indexName);
  }
  if (!accountColumnNullable) {
    await sequelize.query(
      'ALTER TABLE payments MODIFY COLUMN account_id INT NULL'
    );
  }
  return {
    created,
    existing: indexStatus.filter((item) => item.exists).map((item) => item.spec.indexName),
    paymentAccountNullableChanged: !accountColumnNullable
  };
}

async function run() {
  const { sequelize } = require('../src/config/database');
  try {
    await sequelize.authenticate();
    const result = await ensureWechatSpNoUniqueIndexes(sequelize);
    const changes = [];
    if (result.created.length > 0) {
      changes.push(`已创建唯一索引：${result.created.join(', ')}`);
    }
    if (result.paymentAccountNullableChanged) {
      changes.push('已允许 payments.account_id 在 pending 状态暂时为空');
    }
    console.log(changes.length > 0
      ? changes.join('；')
      : '企微审批数据库约束已满足，无需修改');
  } catch (error) {
    console.error('企微审批 sp_no 唯一索引迁移失败:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = { ensureWechatSpNoUniqueIndexes };
