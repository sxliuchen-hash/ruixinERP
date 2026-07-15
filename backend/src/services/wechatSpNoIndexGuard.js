'use strict';

const INDEX_SPECS = Object.freeze([
  Object.freeze({ table: 'contracts', indexName: 'uk_contracts_sp_no', column: 'sp_no' }),
  Object.freeze({ table: 'payments', indexName: 'uk_payments_sp_no', column: 'sp_no' }),
  Object.freeze({ table: 'expenses', indexName: 'uk_expenses_sp_no', column: 'sp_no' })
]);

function normalizeQueryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

async function assertWechatSpNoUniqueIndexes(sequelize) {
  const invalid = [];
  for (const spec of INDEX_SPECS) {
    const result = await sequelize.query(
      `SHOW INDEX FROM ${spec.table} WHERE Key_name = '${spec.indexName}'`
    );
    const rows = normalizeQueryRows(result) || [];
    const isCorrect = rows.length === 1 &&
      Number(rows[0].Non_unique) === 0 &&
      rows[0].Column_name === spec.column;
    if (!isCorrect) invalid.push(`${spec.table}.${spec.column}(${spec.indexName})`);
  }

  if (invalid.length > 0) {
    throw new Error(
      `企微审批 sp_no 唯一索引缺失或定义错误：${invalid.join(', ')}；` +
      '请先运行 npm run migrate:wechat-sp-no-unique'
    );
  }
  const accountColumnResult = await sequelize.query(
    "SHOW COLUMNS FROM payments WHERE Field = 'account_id'"
  );
  const accountColumnRows = normalizeQueryRows(accountColumnResult) || [];
  if (accountColumnRows.length !== 1 || accountColumnRows[0].Null !== 'YES') {
    throw new Error(
      'payments.account_id 必须允许企微 pending 付款暂时为空；' +
      '请先运行 npm run migrate:wechat-sp-no-unique'
    );
  }
  return true;
}

module.exports = {
  INDEX_SPECS,
  normalizeQueryRows,
  assertWechatSpNoUniqueIndexes
};
