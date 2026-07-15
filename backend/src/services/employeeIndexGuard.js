'use strict';

const INDEX_NAME = 'uk_employees_user_id';

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

async function assertEmployeeUserIdUniqueIndex(sequelize) {
  const result = await sequelize.query(
    `SHOW INDEX FROM employees WHERE Key_name = '${INDEX_NAME}'`
  );
  const rows = normalizeQueryRows(result) || [];
  const isCorrect = rows.length === 1 &&
    Number(rows[0].Non_unique) === 0 &&
    rows[0].Column_name === 'user_id';

  if (!isCorrect) {
    throw new Error(
      `employees.user_id 唯一索引 ${INDEX_NAME} 缺失或定义错误；` +
      '请先运行 npm run migrate:employee-user-id-unique'
    );
  }
  return true;
}

module.exports = {
  INDEX_NAME,
  assertEmployeeUserIdUniqueIndex,
  normalizeQueryRows
};
