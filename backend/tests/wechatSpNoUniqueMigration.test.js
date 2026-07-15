'use strict';

const packageJson = require('../package.json');
const {
  ensureWechatSpNoUniqueIndexes
} = require('../scripts/run-wechat-sp-no-unique-migration');
const {
  INDEX_SPECS,
  assertWechatSpNoUniqueIndexes
} = require('../src/services/wechatSpNoIndexGuard');
const { Contract, Payment, Expense } = require('../src/models');

describe('企微审批 sp_no 数据库级幂等', () => {
  test('模型声明与迁移命令覆盖 contract/payment/expense 三张表', () => {
    expect(packageJson.scripts['migrate:wechat-sp-no-unique'])
      .toBe('node scripts/run-wechat-sp-no-unique-migration.js');
    expect(INDEX_SPECS).toEqual([
      { table: 'contracts', indexName: 'uk_contracts_sp_no', column: 'sp_no' },
      { table: 'payments', indexName: 'uk_payments_sp_no', column: 'sp_no' },
      { table: 'expenses', indexName: 'uk_expenses_sp_no', column: 'sp_no' }
    ]);

    for (const [model, indexName] of [
      [Contract, 'uk_contracts_sp_no'],
      [Payment, 'uk_payments_sp_no'],
      [Expense, 'uk_expenses_sp_no']
    ]) {
      expect(model.options.indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: indexName,
          unique: true,
          fields: expect.arrayContaining(['sp_no'])
        })
      ]));
    }
    expect(Payment.rawAttributes.account_id.allowNull).toBe(true);
  });

  test('迁移先检查全部重复值，再为缺失表创建唯一索引', async () => {
    const query = jest.fn();
    for (let index = 0; index < INDEX_SPECS.length; index += 1) {
      query.mockResolvedValueOnce([[], {}]);
      query.mockResolvedValueOnce([[{ blank_count: 0 }], {}]);
      query.mockResolvedValueOnce([[], {}]);
    }
    query.mockResolvedValueOnce([[{ Field: 'account_id', Null: 'NO' }], {}]);
    query.mockResolvedValue([[], {}]);

    const result = await ensureWechatSpNoUniqueIndexes({ query });

    expect(result.created).toEqual(INDEX_SPECS.map((item) => item.indexName));
    const statements = query.mock.calls.map((call) => call[0]);
    const firstAlter = statements.findIndex((sql) => /ALTER TABLE/.test(sql));
    expect(firstAlter).toBe(INDEX_SPECS.length * 3 + 1);
    expect(result.paymentAccountNullableChanged).toBe(true);
    for (const spec of INDEX_SPECS) {
      expect(statements).toEqual(expect.arrayContaining([
        expect.stringContaining(
          `ALTER TABLE ${spec.table} ADD UNIQUE INDEX ${spec.indexName} (${spec.column})`
        )
      ]));
    }
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('ALTER TABLE payments MODIFY COLUMN account_id INT NULL')
    ]));
  });

  test('任一表存在重复 sp_no 时不执行 ALTER，保留数据供人工核对', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{ sp_no: 'SP-DUP', duplicate_count: 2 }], {}])
      .mockResolvedValueOnce([[{ blank_count: 0 }], {}])
      .mockResolvedValueOnce([[], {}])
      .mockResolvedValueOnce([[], {}])
      .mockResolvedValueOnce([[{ blank_count: 0 }], {}])
      .mockResolvedValueOnce([[], {}])
      .mockResolvedValueOnce([[], {}])
      .mockResolvedValueOnce([[{ blank_count: 0 }], {}])
      .mockResolvedValueOnce([[], {}])
      .mockResolvedValueOnce([[{ Field: 'account_id', Null: 'YES' }], {}]);

    await expect(ensureWechatSpNoUniqueIndexes({ query })).rejects.toThrow('SP-DUP(2)');
    expect(query.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/ALTER TABLE/);
  });

  test('任一表存在空字符串或纯空白 sp_no 时停止迁移，不把脏值当作有效幂等键', async () => {
    const query = jest.fn();
    for (let index = 0; index < INDEX_SPECS.length; index += 1) {
      query.mockResolvedValueOnce([[], {}]);
      query.mockResolvedValueOnce([[{ blank_count: index === 1 ? 2 : 0 }], {}]);
      query.mockResolvedValueOnce([[], {}]);
    }
    query.mockResolvedValueOnce([[{ Field: 'account_id', Null: 'YES' }], {}]);

    await expect(ensureWechatSpNoUniqueIndexes({ query }))
      .rejects.toThrow('payments: 空白 sp_no(2)');
    expect(query.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/ALTER TABLE/);
  });

  test('启动门禁要求三个索引都必须是 sp_no 单列唯一索引', async () => {
    const validRow = (spec) => [[{
      Key_name: spec.indexName,
      Non_unique: 0,
      Column_name: 'sp_no'
    }], {}];
    const validQuery = jest.fn();
    for (const spec of INDEX_SPECS) validQuery.mockResolvedValueOnce(validRow(spec));
    validQuery.mockResolvedValueOnce([[{ Field: 'account_id', Null: 'YES' }], {}]);
    await expect(assertWechatSpNoUniqueIndexes({ query: validQuery })).resolves.toBe(true);

    const invalidQuery = jest.fn()
      .mockResolvedValueOnce(validRow(INDEX_SPECS[0]))
      .mockResolvedValueOnce([[{
        Key_name: INDEX_SPECS[1].indexName,
        Non_unique: 1,
        Column_name: 'sp_no'
      }], {}])
      .mockResolvedValueOnce(validRow(INDEX_SPECS[2]));
    await expect(assertWechatSpNoUniqueIndexes({ query: invalidQuery }))
      .rejects.toThrow('npm run migrate:wechat-sp-no-unique');

    const nonNullableQuery = jest.fn();
    for (const spec of INDEX_SPECS) nonNullableQuery.mockResolvedValueOnce(validRow(spec));
    nonNullableQuery.mockResolvedValueOnce([[{ Field: 'account_id', Null: 'NO' }], {}]);
    await expect(assertWechatSpNoUniqueIndexes({ query: nonNullableQuery }))
      .rejects.toThrow('payments.account_id');
  });
});
