const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

jest.mock('../src/config/database', () => ({
  sequelize: { query: jest.fn() }
}));

jest.mock('../src/models/Payment', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Contract', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Customer', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Supplier', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/BankAccount', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Invoice', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Expense', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/PatentInventory', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Project', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/CostRecord', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/CostCategory', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Payroll', () => ({ findAll: jest.fn() }));
jest.mock('../src/models/Employee', () => ({ findAll: jest.fn() }));

jest.mock('../src/utils/excelHelper', () => ({
  buildExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
  buildFilename: jest.fn((name) => `${name}.xlsx`)
}));

const Payment = require('../src/models/Payment');
const Contract = require('../src/models/Contract');
const Invoice = require('../src/models/Invoice');
const Expense = require('../src/models/Expense');
const PatentInventory = require('../src/models/PatentInventory');
const Project = require('../src/models/Project');
const CostRecord = require('../src/models/CostRecord');
const CostCategory = require('../src/models/CostCategory');
const Payroll = require('../src/models/Payroll');
const Employee = require('../src/models/Employee');
const exportService = require('../src/services/exportService');
const manifest = require('../src/permissions/erp-permission-manifest.json');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');
const { normalizePermissionGrant } = require('../src/permissions/permissionGrant');
const { buildLegacyPermissions } = require('../src/permissions/legacyRoleAdapter');
const {
  DENY_MATCH_VALUE,
  buildCombinedDataScopeFilter
} = require('../src/permissions/dataScope');

const BACKEND_SRC = path.resolve(__dirname, '..', 'src');

function permissionDefinition(code) {
  return manifest.modules
    .flatMap((module) => module.permissions)
    .find((permission) => permission.code === code);
}

function buildUser(id, grants) {
  return {
    id,
    role: 'supervisor',
    authSource: 'main_sso',
    permissions: grants
  };
}

describe('模块级导出权限与数据范围', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of [
      Payment,
      Contract,
      Invoice,
      Expense,
      PatentInventory,
      Project,
      CostRecord,
      CostCategory,
      Payroll,
      Employee
    ]) {
      model.findAll.mockResolvedValue([]);
    }
  });

  describe('view/export scope 组合', () => {
    const userId = 17;

    test.each([
      ['self + all => self', 'self', 'all', { created_by: userId }],
      ['all + self => self', 'all', 'self', { created_by: userId }]
    ])('%s', async (_label, viewScope, exportScope, expected) => {
      const user = buildUser(userId, {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: viewScope },
        [PERMISSIONS.PAYMENT_EXPORT]: { allowed: true, scope: exportScope }
      });

      await expect(buildCombinedDataScopeFilter({
        user,
        permissionCodes: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT],
        ownerField: 'created_by'
      })).resolves.toEqual(expected);
    });

    test('team + all => team，并对团队 ID 去重、过滤非法值且包含本人', async () => {
      const resolveTeamUserIds = jest.fn().mockResolvedValue([19, '19', 23, 0, 'bad']);
      const user = buildUser(userId, {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: 'team' },
        [PERMISSIONS.PAYMENT_EXPORT]: { allowed: true, scope: 'all' }
      });

      const result = await buildCombinedDataScopeFilter({
        user,
        permissionCodes: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT],
        ownerField: 'created_by',
        resolveTeamUserIds
      });

      expect(resolveTeamUserIds).toHaveBeenCalledWith(userId);
      expect(result.created_by[Op.in]).toEqual([19, 23, userId]);
    });

    test('all + all 不增加属主过滤', async () => {
      const user = buildUser(userId, {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.PAYMENT_EXPORT]: { allowed: true, scope: 'all' }
      });

      await expect(buildCombinedDataScopeFilter({
        user,
        permissionCodes: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT],
        ownerField: 'created_by'
      })).resolves.toEqual({});
    });

    test('项目 team 范围同时约束 created_by 和 owner_id', async () => {
      const user = buildUser(userId, {
        [PERMISSIONS.PROJECT_VIEW]: { allowed: true, scope: 'team' },
        [PERMISSIONS.PROJECT_EXPORT]: { allowed: true, scope: 'team' }
      });
      const result = await buildCombinedDataScopeFilter({
        user,
        permissionCodes: [PERMISSIONS.PROJECT_VIEW, PERMISSIONS.PROJECT_EXPORT],
        ownerFields: ['created_by', 'owner_id'],
        teamUserIds: [userId, 19]
      });

      expect(result[Op.or]).toHaveLength(2);
      expect(result[Op.or][0].created_by[Op.in]).toEqual([userId, 19]);
      expect(result[Op.or][1].owner_id[Op.in]).toEqual([userId, 19]);
    });

    test.each([
      ['缺少 view grant', {
        [PERMISSIONS.PAYMENT_EXPORT]: { allowed: true, scope: 'all' }
      }],
      ['缺少 export grant', {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: 'all' }
      }],
      ['其它模块 export 不能替代 payment export', {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.CONTRACT_EXPORT]: { allowed: true, scope: 'all' }
      }]
    ])('%s 时 fail-closed，保证模块隔离', async (_label, grants) => {
      await expect(buildCombinedDataScopeFilter({
        user: buildUser(userId, grants),
        permissionCodes: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT],
        ownerField: 'created_by'
      })).resolves.toEqual({ created_by: DENY_MATCH_VALUE });
    });

    test.each([
      ['空数组', []],
      ['null', null]
    ])('team 服务返回%s时不能退化为 all', async (_label, teamResult) => {
      const user = buildUser(userId, {
        [PERMISSIONS.PAYMENT_VIEW]: { allowed: true, scope: 'team' },
        [PERMISSIONS.PAYMENT_EXPORT]: { allowed: true, scope: 'team' }
      });

      await expect(buildCombinedDataScopeFilter({
        user,
        permissionCodes: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_EXPORT],
        ownerField: 'created_by',
        resolveTeamUserIds: jest.fn().mockResolvedValue(teamResult)
      })).resolves.toEqual({ created_by: DENY_MATCH_VALUE });
    });
  });

  describe('invoice/cost/payroll 只支持 all', () => {
    test.each([
      ['invoice', PERMISSIONS.INVOICE_EXPORT],
      ['cost', PERMISSIONS.COST_EXPORT],
      ['payroll', PERMISSIONS.PAYROLL_EXPORT]
    ])('%s export Manifest 只声明 all，self/team grant 会被归一化拒绝', (_name, code) => {
      expect(permissionDefinition(code).scopes).toEqual(['all']);
      expect(normalizePermissionGrant({ allowed: true, scope: 'self' }, code))
        .toEqual({ allowed: false, scope: 'none' });
      expect(normalizePermissionGrant({ allowed: true, scope: 'team' }, code))
        .toEqual({ allowed: false, scope: 'none' });
      expect(normalizePermissionGrant({ allowed: true, scope: 'all' }, code))
        .toEqual({ allowed: true, scope: 'all' });
    });
  });

  describe('legacy 灰度导出权限', () => {
    const moduleExportPermissions = [
      PERMISSIONS.PAYMENT_EXPORT,
      PERMISSIONS.CONTRACT_EXPORT,
      PERMISSIONS.INVENTORY_EXPORT,
      PERMISSIONS.INVOICE_EXPORT,
      PERMISSIONS.EXPENSE_EXPORT,
      PERMISSIONS.PROJECT_EXPORT,
      PERMISSIONS.COST_EXPORT,
      PERMISSIONS.PAYROLL_EXPORT
    ];

    test('八个模块导出权限仅旧 admin 获得，process/agent 均不获得', () => {
      const adminPermissions = buildLegacyPermissions('admin');
      const processPermissions = buildLegacyPermissions('process');
      const agentPermissions = buildLegacyPermissions('agent');

      for (const permissionCode of moduleExportPermissions) {
        expect(adminPermissions[permissionCode]).toEqual({ allowed: true, scope: 'all' });
        expect(processPermissions[permissionCode]).toBeUndefined();
        expect(agentPermissions[permissionCode]).toBeUndefined();
      }
    });
  });

  describe('exportService 必须使用 dataFilter，而不是角色分支', () => {
    test('五个可分域模块把 self/team/all dataFilter 原样并入 ORM 查询', async () => {
      const paymentScope = { created_by: { [Op.in]: [17, 19] } };
      await exportService.exportPayments({ type: 'income' }, paymentScope);
      expect(Payment.findAll.mock.calls[0][0].where).toMatchObject({ type: 'income' });
      expect(Payment.findAll.mock.calls[0][0].where.created_by[Op.in]).toEqual([17, 19]);

      const contractScope = { owner_id: 17 };
      await exportService.exportContracts({ status: 'active' }, contractScope);
      expect(Contract.findAll.mock.calls[0][0].where).toMatchObject({ owner_id: 17, status: 'active' });

      const inventoryScope = { created_by: 17 };
      await exportService.exportInventory({ status: 'in_stock' }, inventoryScope);
      expect(PatentInventory.findAll.mock.calls[0][0].where)
        .toMatchObject({ created_by: 17, status: 'in_stock' });

      const expenseScope = { created_by: 17 };
      await exportService.exportExpenses({ user_id: 99 }, expenseScope);
      expect(Expense.findAll.mock.calls[0][0].where)
        .toMatchObject({ created_by: 17, user_id: 99 });

      const projectScope = {
        [Op.or]: [{ created_by: 17 }, { owner_id: 17 }]
      };
      await exportService.exportProjects({ status: 'active' }, projectScope);
      expect(Project.findAll.mock.calls[0][0].where.status).toBe('active');
      expect(Project.findAll.mock.calls[0][0].where[Op.or]).toEqual(projectScope[Op.or]);
    });

    test('查询参数不能覆盖服务端 dataFilter', async () => {
      await exportService.exportPayments({ created_by: 999, owner_id: 999 }, { created_by: 17 });
      expect(Payment.findAll.mock.calls[0][0].where.created_by).toBe(17);

      await exportService.exportContracts({ owner_id: 999, created_by: 999 }, { owner_id: 17 });
      expect(Contract.findAll.mock.calls[0][0].where.owner_id).toBe(17);

      await exportService.exportExpenses({ created_by: 999, user_id: 88 }, { created_by: 17 });
      expect(Expense.findAll.mock.calls[0][0].where)
        .toMatchObject({ created_by: 17, user_id: 88 });
    });

    test('deny filter 原样进入查询，team 失败不会在 service 层退化全量', async () => {
      await exportService.exportPayments({}, { created_by: DENY_MATCH_VALUE });
      expect(Payment.findAll.mock.calls[0][0].where.created_by).toBe(DENY_MATCH_VALUE);
    });

    test('invoice/cost/payroll 的 all scope 使用空 dataFilter', async () => {
      await exportService.exportInvoices({ status: 'pending' }, {});
      expect(Invoice.findAll.mock.calls[0][0].where).toEqual({ status: 'pending' });

      await exportService.exportCosts({ cost_month: '2026-07' }, {});
      expect(CostRecord.findAll.mock.calls[0][0].where).toEqual({ cost_month: '2026-07' });

      await exportService.exportPayroll({ year: '2026', month: '7', status: 'confirmed' }, {});
      expect(Payroll.findAll.mock.calls[0][0].where).toEqual({
        year: 2026,
        month: 7,
        status: 'confirmed'
      });
    });

    test.each([
      ['exportPayments', Payment],
      ['exportContracts', Contract],
      ['exportInventory', PatentInventory],
      ['exportInvoices', Invoice],
      ['exportExpenses', Expense],
      ['exportProjects', Project],
      ['exportCosts', CostRecord],
      ['exportPayroll', Payroll]
    ])('%s 始终保留 5000 条硬上限', async (method, model) => {
      await exportService[method]({}, {});
      expect(model.findAll.mock.calls[0][0].limit).toBe(5000);
    });

    test('exportService 源码不再通过 userRole/agent 分支决定范围', () => {
      const source = fs.readFileSync(
        path.join(BACKEND_SRC, 'services', 'exportService.js'),
        'utf8'
      );
      expect(source).not.toMatch(/userRole/);
      expect(source).not.toMatch(/role\s*===?\s*['"]agent['"]/);
    });
  });
});
