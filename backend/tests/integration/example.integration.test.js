/**
 * 集成测试脚手架示例（需测试库）
 * 默认跳过；设置 RUN_DB_TESTS=1 且配置好测试库后才运行。详见 ./README.md
 *
 * 覆盖：paymentService.applyConfirmedSideEffects —— 业务类已确认付款应累加合同 paid_amount。
 * 该用例验证本轮「企微同步/历史导入联动根因修复」所复用的核心副作用逻辑。
 */
const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

const { sequelize } = require('../../src/config/database');
const Contract = require('../../src/models/Contract');
const Payment = require('../../src/models/Payment');
const BankAccount = require('../../src/models/BankAccount');
const paymentService = require('../../src/services/paymentService');

describeDb('paymentService.applyConfirmedSideEffects（集成）', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close();
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
});
