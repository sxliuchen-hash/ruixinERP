'use strict';

const TABLE_NAME = 'performance_imports';
const GENERATED_COLUMN = 'confirmed_period_key';
const INDEX_NAME = 'uk_performance_imports_confirmed_period';

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

function normalizeGenerationExpression(expression) {
  return String(expression || '')
    .toLowerCase()
    .replace(/_utf8mb4/g, '')
    .replace(/[`'\s()]/g, '');
}

function isExpectedGeneratedColumn(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  const expression = normalizeGenerationExpression(row.GENERATION_EXPRESSION);
  return String(row.DATA_TYPE || '').toLowerCase() === 'varchar' &&
    Number(row.CHARACTER_MAXIMUM_LENGTH) === 16 &&
    /stored generated/i.test(String(row.EXTRA || '')) &&
    expression.includes('status=confirmed') &&
    expression.includes('concat') &&
    expression.includes('year') &&
    expression.includes('month') &&
    expression.includes('lpad');
}

function isExpectedUniqueIndex(rows) {
  return Array.isArray(rows) &&
    rows.length === 1 &&
    Number(rows[0].Non_unique) === 0 &&
    rows[0].Column_name === GENERATED_COLUMN;
}

async function readPerformanceImportConstraint(sequelize) {
  const columnResult = await sequelize.query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, EXTRA, GENERATION_EXPRESSION
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${TABLE_NAME}'
      AND COLUMN_NAME = '${GENERATED_COLUMN}'
  `);
  const indexResult = await sequelize.query(
    `SHOW INDEX FROM ${TABLE_NAME} WHERE Key_name = '${INDEX_NAME}'`
  );
  return {
    columnRows: normalizeQueryRows(columnResult) || [],
    indexRows: normalizeQueryRows(indexResult) || []
  };
}

async function assertPerformanceImportConfirmedPeriodUniqueIndex(sequelize) {
  const { columnRows, indexRows } = await readPerformanceImportConstraint(sequelize);
  if (!isExpectedGeneratedColumn(columnRows) || !isExpectedUniqueIndex(indexRows)) {
    throw new Error(
      `业绩已确认批次唯一约束 ${INDEX_NAME} 缺失或定义错误；` +
      '请先运行 npm run migrate:performance-confirmed-period-unique'
    );
  }
  return true;
}

module.exports = {
  TABLE_NAME,
  GENERATED_COLUMN,
  INDEX_NAME,
  normalizeQueryRows,
  normalizeGenerationExpression,
  isExpectedGeneratedColumn,
  isExpectedUniqueIndex,
  readPerformanceImportConstraint,
  assertPerformanceImportConfirmedPeriodUniqueIndex
};
