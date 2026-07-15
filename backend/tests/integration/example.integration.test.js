/**
 * 关键业务流程数据库集成测试（需独立测试库）
 * 默认跳过；设置 RUN_DB_TESTS=1 且配置好测试库后才运行。详见 ./README.md
 *
 * 覆盖：薪酬结构启动门禁、合同金额联动、详情数据范围、账户转账事务/行锁、业绩批次防重复。
 */
const path = require('path');
const dotenv = require('dotenv');
const { normalizeTestDatabaseName } = require('../../scripts/init-test-database');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.test') });

const runDbTests = process.env.RUN_DB_TESTS === '1';
if (runDbTests) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('RUN_DB_TESTS=1 时必须显式设置 NODE_ENV=test');
  }
  normalizeTestDatabaseName(process.env.DB_NAME);
}
const describeDb = runDbTests ? describe : describe.skip;

const { Op } = require('sequelize');
const {
  sequelize,
  Contract,
  Payment,
  BankAccount,
  AccountTransfer,
  Expense,
  PerformanceImport,
  PerformanceRecord,
  SystemSetting
} = require('../../src/models');
const paymentService = require('../../src/services/paymentService');
const expenseService = require('../../src/services/expenseService');
const accountService = require('../../src/services/accountService');
const performanceUploadService = require('../../src/services/performanceUploadService');
const { assertPayrollSchemaReady } = require('../../src/services/payrollSchemaGuard');
const {
  DEFAULT_SETTING,
  ensureSystemSettingsSchema
} = require('../../scripts/run-system-settings-migration');

function uniqueToken(label) {
  return `${label}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

async function destroyTransferFixture(accountIds) {
  if (!accountIds.length) return;
  await AccountTransfer.destroy({
    where: {
      [Op.or]: [
        { from_account_id: { [Op.in]: accountIds } },
        { to_account_id: { [Op.in]: accountIds } }
      ]
    }
  });
  await BankAccount.destroy({ where: { id: { [Op.in]: accountIds } } });
}

async function destroyPerformanceFixture(year, month) {
  const batches = await PerformanceImport.findAll({
    attributes: ['id'],
    where: { year, month },
    raw: true
  });
  const batchIds = batches.map(({ id }) => id);
  if (batchIds.length > 0) {
    await PerformanceRecord.destroy({ where: { batch_id: { [Op.in]: batchIds } } });
    await PerformanceImport.destroy({ where: { id: { [Op.in]: batchIds } } });
  }
}

describeDb('关键业务流程（真实 MySQL 集成）', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('显式迁移后的真实 MySQL 薪酬结构通过只读启动门禁', async () => {
    await expect(assertPayrollSchemaReady(sequelize)).resolves.toBe(true);
  });

  test('新库 system_settings 与显式迁移一致，重复执行保持只读 no-op', async () => {
    await expect(ensureSystemSettingsSchema(sequelize)).resolves.toEqual({
      changed: false,
      statements: []
    });
    await expect(ensureSystemSettingsSchema(sequelize)).resolves.toEqual({
      changed: false,
      statements: []
    });

    const setting = await SystemSetting.findOne({
      where: { setting_key: DEFAULT_SETTING.key },
      raw: true
    });
    expect(setting).toBeTruthy();
    expect(setting.setting_value).toEqual(DEFAULT_SETTING.value);
    expect(setting.description).toBe(DEFAULT_SETTING.description);
    expect(setting.category).toBe(DEFAULT_SETTING.category);
  });

  test('business + confirmed 付款累加合同 paid_amount', async () => {
    const t = await sequelize.transaction();
    try {
      const account = await BankAccount.create(
        { name: 'TEST-ACC', account_type: 'public', initial_balance: 0 },
        { transaction: t }
      );
      const contract = await Contract.create(
        {
          contract_no: 'IT-' + Date.now(),
          type: 'sale',
          title: '集成测试合同',
          amount: 10000,
          paid_amount: 0,
          status: 'active'
        },
        { transaction: t }
      );
      const payment = await Payment.create(
        {
          type: 'income',
          category: 'business',
          amount: 3000,
          payment_date: '2026-06-01',
          account_id: account.id,
          contract_id: contract.id,
          confirm_status: 'confirmed'
        },
        { transaction: t }
      );

      await paymentService.applyConfirmedSideEffects(payment, t);

      const reloaded = await Contract.findByPk(contract.id, { transaction: t });
      expect(parseFloat(reloaded.paid_amount)).toBeCloseTo(3000, 2);
    } finally {
      // 回滚清理，避免污染测试库
      await t.rollback();
    }
  });

  test('expenseService.getDetail 拒绝读取其他 created_by 的报销单', async () => {
    const ownerId = 910001;
    const otherAgentId = 910002;
    const expense = await Expense.create({
      user_id: ownerId,
      amount: 100,
      expense_date: '2026-07-11',
      confirm_status: 'confirmed',
      summary: uniqueToken('IT-SCOPE'),
      created_by: ownerId
    });

    try {
      await expect(
        expenseService.getDetail(expense.id, { created_by: otherAgentId })
      ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

      const visible = await expenseService.getDetail(expense.id, { created_by: ownerId });
      expect(visible.id).toBe(expense.id);
      expect(visible.created_by).toBe(ownerId);
    } finally {
      await Expense.destroy({ where: { id: expense.id } });
    }
  });

  test('accountService.transfer 余额不足时事务回滚且不写转账流水', async () => {
    const token = uniqueToken('IT-INSUFFICIENT');
    const accounts = await BankAccount.bulkCreate([
      {
        name: `${token}-FROM`,
        account_no: `${token}-F`.slice(0, 50),
        account_type: 'public',
        initial_balance: 100,
        status: 1
      },
      {
        name: `${token}-TO`,
        account_no: `${token}-T`.slice(0, 50),
        account_type: 'public',
        initial_balance: 0,
        status: 1
      }
    ]);
    const accountIds = accounts.map(({ id }) => id);

    try {
      await expect(accountService.transfer({
        from_account_id: accounts[0].id,
        to_account_id: accounts[1].id,
        amount: 100.01,
        transfer_date: '2026-07-11',
        remark: token
      }, 910003)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400
      });

      const inserted = await AccountTransfer.count({
        where: { from_account_id: accounts[0].id, remark: token }
      });
      expect(inserted).toBe(0);
      await expect(accountService.calculateBalance(accounts[0].id, 100)).resolves.toBe(100);
    } finally {
      await destroyTransferFixture(accountIds);
    }
  });

  test('accountService.transfer 并发出账由行锁串行化且不会超额', async () => {
    const token = uniqueToken('IT-CONCURRENT');
    const accounts = await BankAccount.bulkCreate([
      {
        name: `${token}-FROM`,
        account_no: `${token}-F`.slice(0, 50),
        account_type: 'public',
        initial_balance: 100,
        status: 1
      },
      {
        name: `${token}-TO-A`,
        account_no: `${token}-A`.slice(0, 50),
        account_type: 'public',
        initial_balance: 0,
        status: 1
      },
      {
        name: `${token}-TO-B`,
        account_no: `${token}-B`.slice(0, 50),
        account_type: 'public',
        initial_balance: 0,
        status: 1
      }
    ]);
    const accountIds = accounts.map(({ id }) => id);
    const transfer = (toAccountId, suffix) => accountService.transfer({
      from_account_id: accounts[0].id,
      to_account_id: toAccountId,
      amount: 80,
      transfer_date: '2026-07-11',
      remark: `${token}-${suffix}`
    }, 910004);

    try {
      const results = await Promise.allSettled([
        transfer(accounts[1].id, 'A'),
        transfer(accounts[2].id, 'B')
      ]);
      const fulfilled = results.filter(({ status }) => status === 'fulfilled');
      const rejected = results.filter(({ status }) => status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400
      });

      const transfers = await AccountTransfer.findAll({
        where: { from_account_id: accounts[0].id },
        raw: true
      });
      const transferredAmount = transfers.reduce(
        (sum, row) => sum + parseFloat(row.amount),
        0
      );
      expect(transfers).toHaveLength(1);
      expect(transferredAmount).toBe(80);
      expect(transferredAmount).toBeLessThanOrEqual(100);
      await expect(accountService.calculateBalance(accounts[0].id, 100)).resolves.toBe(20);
    } finally {
      await destroyTransferFixture(accountIds);
    }
  }, 15000);

  test('performanceUploadService.confirmImport 拒绝同年月重复确认且不生成第二批次', async () => {
    // 使用测试专属高位年份，避免与任何业务数据相撞；finally 会删除该年月全部测试数据。
    const year = 1_900_000_000 + ((Date.now() + process.pid) % 100_000_000);
    const month = 7;
    const records = [{
      employee_id: 920001,
      user_id: 920001,
      employee_name: '集成测试员工',
      business_type: '集成测试',
      serial_no: uniqueToken('IT-PERFORMANCE'),
      performance_amount: 2000,
      year,
      month
    }];
    const params = {
      year,
      month,
      file_name: uniqueToken('IT-PERFORMANCE-FILE'),
      records,
      userId: 920001
    };

    try {
      const first = await performanceUploadService.confirmImport(params);
      expect(first.record_count).toBe(1);

      await expect(
        performanceUploadService.confirmImport({ ...params, file_name: `${params.file_name}-DUP` })
      ).rejects.toThrow(/已存在已确认的业绩批次/);

      const confirmedBatchCount = await PerformanceImport.count({
        where: { year, month, status: 'confirmed' }
      });
      const recordCount = await PerformanceRecord.count({
        where: { batch_id: first.batch_id }
      });
      expect(confirmedBatchCount).toBe(1);
      expect(recordCount).toBe(1);
    } finally {
      await destroyPerformanceFixture(year, month);
    }
  });

  test('performance_imports 允许同年月多个 draft，但数据库拒绝第二个 confirmed', async () => {
    const year = 1_800_000_000 + ((Date.now() + process.pid) % 100_000_000);
    const month = 8;
    const t = await sequelize.transaction();
    try {
      await PerformanceImport.bulkCreate([
        { year, month, status: 'draft', file_name: 'draft-a.xlsx' },
        { year, month, status: 'draft', file_name: 'draft-b.xlsx' }
      ], { transaction: t });
      await PerformanceImport.create(
        { year, month, status: 'confirmed', file_name: 'confirmed-a.xlsx' },
        { transaction: t }
      );

      await expect(PerformanceImport.create(
        { year, month, status: 'confirmed', file_name: 'confirmed-b.xlsx' },
        { transaction: t }
      )).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });

      const drafts = await PerformanceImport.count({
        where: { year, month, status: 'draft' },
        transaction: t
      });
      expect(drafts).toBe(2);
    } finally {
      await t.rollback();
    }
  });

  test('performanceUploadService.confirmImport 并发确认同年月最多成功一个批次', async () => {
    const year = 1_700_000_000 + ((Date.now() + process.pid) % 100_000_000);
    const month = 9;
    const buildParams = (suffix) => ({
      year,
      month,
      file_name: `concurrent-${suffix}.xlsx`,
      records: [{
        employee_id: 930001,
        user_id: 930001,
        employee_name: '并发集成测试员工',
        serial_no: uniqueToken(`IT-PERFORMANCE-${suffix}`),
        performance_amount: 800,
        year,
        month
      }],
      userId: 930001
    });

    try {
      const results = await Promise.allSettled([
        performanceUploadService.confirmImport(buildParams('A')),
        performanceUploadService.confirmImport(buildParams('B'))
      ]);
      const fulfilled = results.filter(({ status }) => status === 'fulfilled');
      const rejected = results.filter(({ status }) => status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400
      });
      await expect(PerformanceImport.count({
        where: { year, month, status: 'confirmed' }
      })).resolves.toBe(1);
    } finally {
      await destroyPerformanceFixture(year, month);
    }
  }, 15000);
});
