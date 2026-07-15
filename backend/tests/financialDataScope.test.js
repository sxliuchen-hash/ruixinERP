const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

jest.mock('../src/config/database', () => ({
  sequelize: {
    query: jest.fn(),
    transaction: jest.fn()
  }
}));
jest.mock('../src/models/Payment', () => ({
  findAndCountAll: jest.fn(),
  findOne: jest.fn()
}));
jest.mock('../src/models/Contract', () => ({
  findAll: jest.fn()
}));
jest.mock('../src/models/BankAccount', () => ({
  findByPk: jest.fn()
}));
jest.mock('../src/models/Expense', () => ({
  findAndCountAll: jest.fn(),
  findOne: jest.fn()
}));
jest.mock('../src/models/Loan', () => ({
  findAndCountAll: jest.fn(),
  findOne: jest.fn(),
  findByPk: jest.fn()
}));
jest.mock('../src/models/LoanRepayment', () => ({
  findOne: jest.fn()
}));

const { sequelize } = require('../src/config/database');
const Payment = require('../src/models/Payment');
const Contract = require('../src/models/Contract');
const Expense = require('../src/models/Expense');
const Loan = require('../src/models/Loan');
const paymentService = require('../src/services/paymentService');
const expenseService = require('../src/services/expenseService');
const loanService = require('../src/services/loanService');

describe('payment/expense/loan 数据权限迁移', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Payment.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    Expense.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    Loan.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    Contract.findAll.mockResolvedValue([]);
    sequelize.query.mockResolvedValue([]);
  });

  test.each([
    ['payment', paymentService, Payment],
    ['expense', expenseService, Expense],
    ['loan', loanService, Loan]
  ])('%s 列表缺失 dataFilter 时必须查询不可能匹配的 created_by', async (_name, service, model) => {
    await service.getList({}, undefined);

    expect(model.findAndCountAll).toHaveBeenCalledTimes(1);
    expect(model.findAndCountAll.mock.calls[0][0].where).toMatchObject({ created_by: -1 });
  });

  test.each([
    ['payment', paymentService, Payment],
    ['expense', expenseService, Expense],
    ['loan', loanService, Loan]
  ])('%s 列表支持 team/all 范围', async (_name, service, model) => {
    const teamFilter = { created_by: { [Op.in]: [7, 9] } };
    await service.getList({}, teamFilter);
    expect(model.findAndCountAll.mock.calls[0][0].where.created_by[Op.in]).toEqual([7, 9]);

    model.findAndCountAll.mockClear();
    await service.getList({}, {});
    expect(model.findAndCountAll.mock.calls[0][0].where).toEqual({});
  });

  test('详情查询把 self/team 范围放进同一条数据库查询', async () => {
    Payment.findOne.mockResolvedValue(null);
    Expense.findOne.mockResolvedValue(null);
    Loan.findOne.mockResolvedValue(null);

    await expect(paymentService.getDetail(11, { created_by: 7 })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    await expect(expenseService.getDetail(12, { created_by: { [Op.in]: [7, 9] } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    await expect(loanService.getDetail(13, undefined)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });

    expect(Payment.findOne.mock.calls[0][0].where).toEqual({ id: 11, created_by: 7 });
    expect(Expense.findOne.mock.calls[0][0].where.created_by[Op.in]).toEqual([7, 9]);
    expect(Loan.findOne.mock.calls[0][0].where).toEqual({ id: 13, created_by: -1 });
  });

  test('汇总接口也应用 dataFilter，不会只隔离列表', async () => {
    await expenseService.getMonthlySummary({}, { created_by: { [Op.in]: [7, 9] } });
    let [sql, options] = sequelize.query.mock.calls[0];
    expect(sql).toContain('created_by IN (:scope_created_by_ids)');
    expect(options.replacements.scope_created_by_ids).toEqual([7, 9]);

    sequelize.query.mockClear();
    await loanService.getSummary({}, undefined);
    [sql, options] = sequelize.query.mock.calls[0];
    expect(sql).toContain('created_by = :scope_created_by');
    expect(options.replacements.scope_created_by).toBe(-1);

    await paymentService.getReceivable({}, { created_by: 7 });
    expect(Contract.findAll.mock.calls[0][0].where).toEqual({ type: 'sale', created_by: 7 });
  });

  test.each(['payments', 'expenses', 'loans'])(
    '%s 路由不再使用静态角色中间件，且声明具体权限与数据范围',
    (routeName) => {
      const source = fs.readFileSync(
        path.join(__dirname, `../src/routes/${routeName}.js`),
        'utf8'
      );

      expect(source).not.toContain('requireErpAccess');
      expect(source).not.toContain('attachDataFilter');
      expect(source).toContain('requirePermission(PERMISSIONS.');
      expect(source).toContain('attachPermissionDataScope(PERMISSIONS.');
    }
  );

  test.each(['paymentService', 'expenseService', 'loanService'])(
    '%s 不再通过 userRole/agent 分支决定数据范围',
    (serviceName) => {
      const source = fs.readFileSync(
        path.join(__dirname, `../src/services/${serviceName}.js`),
        'utf8'
      );

      expect(source).not.toContain('userRole');
      expect(source).not.toContain("role === 'agent'");
    }
  );
});
