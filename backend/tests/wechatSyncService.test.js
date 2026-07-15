'use strict';

const wechatConfig = require('../src/config/wechat');
const wechatApiService = require('../src/services/wechat/wechatApiService');
const {
  WechatSyncService
} = require('../src/services/wechat/wechatSyncService');
const paymentService = require('../src/services/paymentService');
const wechatController = require('../src/controllers/wechatController');
const wechatSyncService = require('../src/services/wechat/wechatSyncService');
const { sequelize } = require('../src/config/database');
const {
  Contract,
  Payment,
  Expense,
  BankAccount
} = require('../src/models');

describe('企微审批模板动态分发', () => {
  const originalTemplates = { ...wechatConfig.templates };

  afterEach(() => {
    Object.assign(wechatConfig.templates, originalTemplates);
    jest.restoreAllMocks();
  });

  test('contract/payment/expense 从配置解析，空值忽略，loan 明确 unsupported', () => {
    const result = wechatConfig.resolveTemplateConfiguration({
      contract: 'tpl-contract',
      payment: 'tpl-payment',
      expense: 'tpl-expense',
      loan: 'tpl-loan',
      empty: ''
    });

    expect(result.handlers).toEqual({
      'tpl-contract': 'syncContract',
      'tpl-payment': 'syncPayment',
      'tpl-expense': 'syncExpense'
    });
    expect(result.unsupported).toEqual([
      { templateId: 'tpl-loan', type: 'loan' }
    ]);
  });

  test('重复模板 ID 全部 fail-closed，不会误分发到任一业务处理器', async () => {
    Object.assign(wechatConfig.templates, {
      contract: 'duplicate-template',
      payment: 'duplicate-template',
      expense: '',
      loan: ''
    });
    const service = new WechatSyncService();
    jest.spyOn(wechatApiService, 'getApprovalDetail').mockResolvedValue({
      info: { sp_no: 'SP-DUP', sp_status: 2, template_id: 'duplicate-template' }
    });
    const contractSpy = jest.spyOn(service, 'syncContract');
    const paymentSpy = jest.spyOn(service, 'syncPayment');

    await expect(service.syncBySpNo('SP-DUP')).resolves.toEqual({
      handled: false,
      reason: 'template_configuration_conflict'
    });
    expect(contractSpy).not.toHaveBeenCalled();
    expect(paymentSpy).not.toHaveBeenCalled();
  });

  test('配置的 expense 模板分发到 syncExpense，loan 模板不会伪装成已支持', async () => {
    Object.assign(wechatConfig.templates, {
      contract: '',
      payment: '',
      expense: 'tpl-expense',
      loan: 'tpl-loan'
    });
    const service = new WechatSyncService();
    jest.spyOn(wechatApiService, 'getApprovalDetail')
      .mockResolvedValueOnce({
        info: { sp_no: 'SP-EXP', sp_status: 2, template_id: 'tpl-expense' }
      })
      .mockResolvedValueOnce({
        info: { sp_no: 'SP-LOAN', sp_status: 2, template_id: 'tpl-loan' }
      });
    jest.spyOn(service, 'syncExpense').mockResolvedValue({
      action: 'created', type: 'expense', id: 7
    });

    await expect(service.syncBySpNo('SP-EXP')).resolves.toMatchObject({
      handled: true,
      action: 'created',
      type: 'expense'
    });
    await expect(service.syncBySpNo('SP-LOAN')).resolves.toEqual({
      handled: false,
      reason: 'unsupported_template'
    });
  });
});

describe('企微报销同步', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function approval(overrides = {}) {
    return {
      sp_no: 'SP-EXPENSE-001',
      sp_status: 2,
      apply_time: 1_720_000_000,
      applyer: { userid: 'wechat-user-42' },
      apply_data: { contents: [] },
      ...overrides
    };
  }

  function configureParsedFields(service, overrides = {}) {
    jest.spyOn(service, '_parseApplyData').mockReturnValue({
      报销金额: '1,234.50元',
      费用发生日期: '2026-07-10',
      报销事由: '客户现场交通费',
      费用类型: '交通费',
      付款账户: '招商银行-基本户',
      ...overrides
    });
    jest.spyOn(service, '_resolveUserId').mockResolvedValue(42);
    jest.spyOn(service, '_getApplyerName').mockResolvedValue('测试员工');
    jest.spyOn(service, '_resolveCostCategoryId').mockResolvedValue(8);
    jest.spyOn(service, '_resolveBankAccountId').mockResolvedValue(3);
  }

  test('审批通过时映射申请人、金额、日期、类别和账户，并写入 confirmed', async () => {
    const service = new WechatSyncService();
    configureParsedFields(service);
    jest.spyOn(Expense, 'findOne').mockResolvedValue(null);
    jest.spyOn(Expense, 'create').mockResolvedValue({ id: 99 });

    await expect(service.syncExpense(approval())).resolves.toMatchObject({
      action: 'created',
      type: 'expense',
      id: 99,
      status: 'confirmed'
    });
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 42,
      created_by: 42,
      amount: 1234.5,
      cost_category_id: 8,
      expense_date: '2026-07-10',
      account_id: 3,
      sp_no: 'SP-EXPENSE-001',
      confirm_status: 'confirmed',
      summary: '客户现场交通费'
    }));
  });

  test('审批通过但账户无法安全匹配时保留 pending，避免错误扣减', async () => {
    const service = new WechatSyncService();
    configureParsedFields(service);
    service._resolveBankAccountId.mockResolvedValue(null);
    jest.spyOn(Expense, 'findOne').mockResolvedValue(null);
    jest.spyOn(Expense, 'create').mockResolvedValue({ id: 100 });

    await expect(service.syncExpense(approval())).resolves.toMatchObject({
      action: 'created',
      status: 'pending',
      reason: 'account_confirmation_required'
    });
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      account_id: null,
      confirm_status: 'pending'
    }));
  });

  test('审批中记录后续通过时从 pending 更新为 confirmed，不重复创建', async () => {
    const service = new WechatSyncService();
    configureParsedFields(service);
    const existing = {
      id: 101,
      confirm_status: 'pending',
      update: jest.fn().mockResolvedValue(true)
    };
    jest.spyOn(Expense, 'findOne').mockResolvedValue(existing);
    jest.spyOn(Expense, 'create');

    await expect(service.syncExpense(approval())).resolves.toMatchObject({
      action: 'updated',
      id: 101,
      status: 'confirmed'
    });
    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({
      confirm_status: 'confirmed',
      account_id: 3
    }));
    expect(Expense.create).not.toHaveBeenCalled();
  });

  test('申请人未绑定 ERP 用户或金额非法时 fail-closed', async () => {
    const service = new WechatSyncService();
    configureParsedFields(service);
    service._resolveUserId.mockResolvedValue(null);

    await expect(service.syncExpense(approval())).rejects.toMatchObject({
      statusCode: 409,
      code: 'WECHAT_APPROVAL_APPLYER_UNBOUND'
    });

    jest.restoreAllMocks();
    const invalidAmountService = new WechatSyncService();
    configureParsedFields(invalidAmountService, { 报销金额: '0' });
    await expect(invalidAmountService.syncExpense(approval())).rejects.toMatchObject({
      statusCode: 422,
      code: 'WECHAT_EXPENSE_AMOUNT_INVALID'
    });
  });

  test('驳回或撤销删除报销记录，confirmed 的账户影响随聚合查询同步撤销', async () => {
    const service = new WechatSyncService();
    jest.spyOn(Contract, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    const expense = { id: 102, destroy: jest.fn().mockResolvedValue(true) };
    jest.spyOn(Expense, 'findOne').mockResolvedValue(expense);

    await expect(service._handleRejected('SP-EXPENSE-001', 4)).resolves.toEqual({
      handled: true,
      action: 'deleted',
      type: 'expense',
      id: 102
    });
    expect(expense.destroy).toHaveBeenCalledTimes(1);
  });

  test('付款驳回通过 paymentService.delete 反向合同/成本副作用', async () => {
    const service = new WechatSyncService();
    jest.spyOn(Contract, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payment, 'findOne').mockResolvedValue({ id: 88 });
    jest.spyOn(paymentService, 'delete').mockResolvedValue({ id: 88 });
    jest.spyOn(Expense, 'findOne');

    await expect(service._handleRejected('SP-PAYMENT-001', 3)).resolves.toMatchObject({
      handled: true,
      action: 'deleted',
      type: 'payment',
      id: 88
    });
    expect(paymentService.delete).toHaveBeenCalledWith(88, {});
    expect(Expense.findOne).not.toHaveBeenCalled();
  });

  test('数据库唯一键竞态由 syncBySpNo 恢复为 duplicate，不产生第二次处理', async () => {
    const originalTemplates = { ...wechatConfig.templates };
    Object.assign(wechatConfig.templates, {
      contract: '', payment: '', expense: 'tpl-expense', loan: ''
    });
    const service = new WechatSyncService();
    jest.spyOn(wechatApiService, 'getApprovalDetail').mockResolvedValue({
      info: approval({ template_id: 'tpl-expense' })
    });
    const uniqueError = Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    });
    jest.spyOn(service, 'syncExpense').mockRejectedValue(uniqueError);
    jest.spyOn(Expense, 'findOne').mockResolvedValue({ id: 103 });

    await expect(service.syncBySpNo('SP-EXPENSE-001')).resolves.toMatchObject({
      handled: true,
      action: 'skipped',
      reason: 'duplicate',
      type: 'expense',
      id: 103
    });
    Object.assign(wechatConfig.templates, originalTemplates);
  });

  test('管理员修复映射后可按 spNo 精确重放，不依赖 expense.approve 人工确认', async () => {
    jest.spyOn(wechatSyncService, 'syncBySpNo').mockResolvedValue({
      handled: true,
      action: 'updated',
      type: 'expense',
      id: 104,
      status: 'confirmed'
    });
    jest.spyOn(wechatSyncService, 'batchSync');
    const req = { body: { spNo: ' SP-EXPENSE-001 ' } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await wechatController.manualSync(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(wechatSyncService.syncBySpNo).toHaveBeenCalledWith('SP-EXPENSE-001');
    expect(wechatSyncService.batchSync).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ status: 'confirmed' })
    }));
  });
});

describe('企微 service-only 资金同步账户门禁', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function paymentApproval(overrides = {}) {
    return {
      sp_no: 'SP-PAYMENT-SECURE-001',
      sp_status: 2,
      applyer: { userid: 'wechat-user-42' },
      apply_data: { contents: [] },
      ...overrides
    };
  }

  function configurePayment(service, accountId) {
    jest.spyOn(service, '_parseApplyData').mockReturnValue({
      付款金额: '5000',
      付款日期: '2026-07-11',
      付款事由: '采购合同付款',
      付款方式: '招商银行-基本户',
      关联合同_sp_no: 'SP-CONTRACT-001'
    });
    jest.spyOn(service, '_resolveBankAccountId').mockResolvedValue(accountId);
    jest.spyOn(service, '_resolveUserId').mockResolvedValue(42);
    jest.spyOn(service, '_getApplyerName').mockResolvedValue('测试员工');
    jest.spyOn(service, '_generatePaymentNo').mockResolvedValue('CZ-FK2026071100001');
    jest.spyOn(Contract, 'findOne').mockResolvedValue({ id: 77 });
  }

  test('账户精确或模糊匹配都必须唯一，0 或多个命中均 unresolved', async () => {
    const service = new WechatSyncService();
    const findAll = jest.spyOn(BankAccount, 'findAll');

    findAll.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    await expect(service._resolveBankAccountId('重复简称')).resolves.toBeNull();
    expect(findAll).toHaveBeenCalledTimes(1);

    findAll.mockReset();
    findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3 }, { id: 4 }]);
    await expect(service._resolveBankAccountId('招商银行-基本户')).resolves.toBeNull();

    findAll.mockReset();
    findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5 }]);
    await expect(service._resolveBankAccountId('招商银行-基本户')).resolves.toBe(5);

    findAll.mockReset();
    findAll.mockResolvedValueOnce([{ id: 6 }]);
    await expect(service._resolveBankAccountId('唯一简称')).resolves.toBe(6);
  });

  test('付款审批通过但账户 unresolved 时只创建 pending，不执行资金副作用', async () => {
    const service = new WechatSyncService();
    configurePayment(service, null);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payment, 'create').mockResolvedValue({ id: 201 });
    const sideEffectSpy = jest.spyOn(paymentService, 'applyConfirmedSideEffects');
    const transactionSpy = jest.spyOn(sequelize, 'transaction');

    await expect(service.syncPayment(paymentApproval())).resolves.toMatchObject({
      action: 'created',
      id: 201,
      status: 'pending',
      reason: 'account_confirmation_required'
    });
    expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({
      account_id: null,
      confirm_status: 'pending'
    }));
    expect(sideEffectSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  test('账户映射修复后同一 sp_no 原子转 confirmed，并且副作用只执行一次', async () => {
    const service = new WechatSyncService();
    configurePayment(service, 9);
    const existing = { id: 202, confirm_status: 'pending' };
    jest.spyOn(Payment, 'findOne').mockResolvedValue(existing);
    jest.spyOn(Payment, 'update')
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([0]);
    jest.spyOn(Payment, 'findByPk').mockResolvedValue({
      id: 202,
      category: 'business',
      contract_id: 77,
      amount: 5000,
      confirm_status: 'confirmed'
    });
    jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => (
      callback({ id: 'tx' })
    ));
    const sideEffectSpy = jest.spyOn(paymentService, 'applyConfirmedSideEffects')
      .mockResolvedValue(undefined);

    const results = await Promise.all([
      service.syncPayment(paymentApproval()),
      service.syncPayment(paymentApproval())
    ]);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'updated', status: 'confirmed', id: 202 }),
      expect.objectContaining({ action: 'skipped', reason: 'duplicate', id: 202 })
    ]));
    expect(sideEffectSpy).toHaveBeenCalledTimes(1);
    expect(sideEffectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 202, confirm_status: 'confirmed' }),
      expect.objectContaining({ id: 'tx' })
    );
  });

  test('新建 confirmed 付款与副作用处于同一事务，唯一键竞态不会执行第二次副作用', async () => {
    const service = new WechatSyncService();
    configurePayment(service, 9);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => (
      callback({ id: 'tx-create' })
    ));
    const payment = {
      id: 203,
      category: 'business',
      contract_id: 77,
      amount: 5000,
      confirm_status: 'confirmed'
    };
    jest.spyOn(Payment, 'create').mockResolvedValue(payment);
    const sideEffectSpy = jest.spyOn(paymentService, 'applyConfirmedSideEffects')
      .mockResolvedValue(undefined);

    await expect(service.syncPayment(paymentApproval())).resolves.toMatchObject({
      action: 'created',
      id: 203,
      status: 'confirmed'
    });
    expect(Payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 9, confirm_status: 'confirmed' }),
      expect.objectContaining({ transaction: expect.objectContaining({ id: 'tx-create' }) })
    );
    expect(sideEffectSpy).toHaveBeenCalledTimes(1);
  });

  test('合同已收款无唯一账户时不创建 confirmed 资金记录', async () => {
    const service = new WechatSyncService();
    jest.spyOn(service, '_parseApplyData').mockReturnValue({
      合同类型: '销售合同',
      对方单位名称: '',
      签约日期: '2026-07-11',
      合计金额: '10000',
      已收款金额: '3000',
      收款账户: '无法唯一匹配'
    });
    jest.spyOn(service, '_resolveUserId').mockResolvedValue(42);
    jest.spyOn(service, '_getApplyerName').mockResolvedValue('测试员工');
    jest.spyOn(service, '_generateContractNo').mockResolvedValue('CZ-XS2026071100001');
    jest.spyOn(service, '_resolveBankAccountId').mockResolvedValue(null);
    jest.spyOn(Contract, 'findOne').mockResolvedValue(null);
    jest.spyOn(Contract, 'create').mockResolvedValue({ id: 301 });
    const paymentCreateSpy = jest.spyOn(Payment, 'create');

    await expect(service.syncContract({
      sp_no: 'SP-CONTRACT-SECURE-001',
      sp_status: 2,
      applyer: { userid: 'wechat-user-42' },
      apply_data: { contents: [] }
    })).resolves.toMatchObject({
      action: 'created',
      id: 301,
      autoPayment: { created: false, reason: 'account_unresolved' }
    });
    expect(paymentCreateSpy).not.toHaveBeenCalled();
  });
});

describe('企微未绑定主账号审批策略', () => {
  const originalPolicy = process.env.WECHAT_UNBOUND_APPROVAL_POLICY;

  afterEach(() => {
    if (originalPolicy === undefined) {
      delete process.env.WECHAT_UNBOUND_APPROVAL_POLICY;
    } else {
      process.env.WECHAT_UNBOUND_APPROVAL_POLICY = originalPolicy;
    }
    jest.restoreAllMocks();
  });

  function unboundApproval(type) {
    return {
      sp_no: `SP-UNBOUND-${type.toUpperCase()}`,
      sp_status: 2,
      applyer: { userid: 'wechat-user-unbound' },
      apply_data: { contents: [] }
    };
  }

  function prepareUnboundService() {
    const service = new WechatSyncService();
    jest.spyOn(service, '_resolveUserId').mockResolvedValue(null);
    jest.spyOn(service, '_parseApplyData').mockReturnValue({});
    jest.spyOn(service, '_parseMoney').mockReturnValue(100);
    return service;
  }

  test.each([
    ['contract', 'syncContract'],
    ['payment', 'syncPayment'],
    ['expense', 'syncExpense']
  ])('%s 在 reject 策略下于任何写库或副作用前返回统一错误码', async (_type, method) => {
    process.env.WECHAT_UNBOUND_APPROVAL_POLICY = 'reject';
    const service = prepareUnboundService();
    const customerCreate = jest.spyOn(require('../src/models').Customer, 'create');
    const supplierCreate = jest.spyOn(require('../src/models').Supplier, 'create');
    const contractCreate = jest.spyOn(Contract, 'create');
    const paymentCreate = jest.spyOn(Payment, 'create');
    const expenseCreate = jest.spyOn(Expense, 'create');
    const transaction = jest.spyOn(sequelize, 'transaction');
    const paymentSideEffects = jest.spyOn(paymentService, 'applyConfirmedSideEffects');

    await expect(service[method](unboundApproval(_type))).rejects.toMatchObject({
      statusCode: 409,
      code: 'WECHAT_APPROVAL_APPLYER_UNBOUND'
    });

    expect(customerCreate).not.toHaveBeenCalled();
    expect(supplierCreate).not.toHaveBeenCalled();
    expect(contractCreate).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(expenseCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(paymentSideEffects).not.toHaveBeenCalled();
  });

  test('非法策略值运行时 fail-closed，不能意外进入 allow_unowned', async () => {
    process.env.WECHAT_UNBOUND_APPROVAL_POLICY = 'silently_allow';
    const service = prepareUnboundService();
    const contractCreate = jest.spyOn(Contract, 'create');

    await expect(service.syncContract(unboundApproval('contract'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'WECHAT_APPROVAL_APPLYER_UNBOUND'
    });
    expect(wechatConfig.resolveUnboundApprovalPolicy()).toEqual({
      policy: 'reject',
      configured: true,
      valid: false
    });
    expect(contractCreate).not.toHaveBeenCalled();
  });

  test('缺少策略时默认 reject', async () => {
    delete process.env.WECHAT_UNBOUND_APPROVAL_POLICY;
    const service = prepareUnboundService();

    await expect(service.syncPayment(unboundApproval('payment'))).rejects.toMatchObject({
      code: 'WECHAT_APPROVAL_APPLYER_UNBOUND'
    });
    expect(wechatConfig.resolveUnboundApprovalPolicy()).toEqual({
      policy: 'reject',
      configured: false,
      valid: true
    });
  });

  test('allow_unowned 仅在显式配置时允许报销写入 null 属主', async () => {
    process.env.WECHAT_UNBOUND_APPROVAL_POLICY = 'allow_unowned';
    const service = prepareUnboundService();
    jest.spyOn(service, '_resolveCostCategoryId').mockResolvedValue(null);
    jest.spyOn(service, '_resolveBankAccountId').mockResolvedValue(null);
    jest.spyOn(service, '_getApplyerName').mockResolvedValue('未绑定员工');
    jest.spyOn(Expense, 'findOne').mockResolvedValue(null);
    jest.spyOn(Expense, 'create').mockResolvedValue({ id: 501 });

    await expect(service.syncExpense(unboundApproval('expense'))).resolves.toMatchObject({
      action: 'created',
      type: 'expense',
      id: 501
    });
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      user_id: null,
      created_by: null
    }));
  });

  test.each(['contract', 'payment', 'expense'])(
    'allow_unowned 对 %s 统一返回 null，且对应属主字段允许 NULL',
    async (approvalType) => {
      process.env.WECHAT_UNBOUND_APPROVAL_POLICY = 'allow_unowned';
      const service = prepareUnboundService();

      await expect(
        service._resolveApprovalOwnerId(unboundApproval(approvalType), approvalType)
      ).resolves.toBeNull();

      expect(Contract.rawAttributes.created_by.allowNull).toBe(true);
      expect(Payment.rawAttributes.created_by.allowNull).toBe(true);
      expect(Expense.rawAttributes.created_by.allowNull).toBe(true);
      expect(Expense.rawAttributes.user_id.allowNull).toBe(true);
    }
  );
});
