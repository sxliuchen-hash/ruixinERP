const { Op } = require('sequelize');
const {
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  isKnownPermission
} = require('../src/permissions/permissionCodes');
const {
  VALID_SCOPES,
  normalizePermissionGrant,
  normalizePermissions,
  getPermissionGrant
} = require('../src/permissions/permissionGrant');
const {
  LEGACY_ERP_ROLES,
  buildLegacyPermissions
} = require('../src/permissions/legacyRoleAdapter');
const {
  DENY_MATCH_VALUE,
  buildDataScopeFilter
} = require('../src/permissions/dataScope');
const {
  requirePermission,
  hasPermission
} = require('../src/middlewares/requirePermission');
const { dataFilter: legacyDataFilter } = require('../src/middlewares/permission');

describe('ERP 权限核心验收', () => {
  describe('权限 grant 归一化与默认拒绝', () => {
    test.each(['none', 'invalid', '', null, undefined])(
      'allowed=true 但 scope=%p 时必须拒绝',
      (scope) => {
        expect(normalizePermissionGrant({ allowed: true, scope })).toEqual({
          allowed: false,
          scope: 'none'
        });
      }
    );

    test.each(VALID_SCOPES)('合法 scope=%s 保持授权', (scope) => {
      expect(normalizePermissionGrant({ allowed: true, scope })).toEqual({
        allowed: true,
        scope
      });
    });

    test('未知权限编码和非法 grant 不进入权限快照', () => {
      const result = normalizePermissions({
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        'erp.unknown.root': { allowed: true, scope: 'all' },
        [PERMISSIONS.DASHBOARD_VIEW]: { allowed: true, scope: 'root' }
      });

      expect(result).toEqual({
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
      });
    });

    test('缺失用户或缺失权限必须默认拒绝', () => {
      expect(getPermissionGrant(null, PERMISSIONS.APP_VIEW)).toEqual({
        allowed: false,
        scope: 'none'
      });
      expect(getPermissionGrant({ permissions: {} }, PERMISSIONS.APP_VIEW)).toEqual({
        allowed: false,
        scope: 'none'
      });
      expect(hasPermission({ permissions: {} }, PERMISSIONS.APP_VIEW)).toBe(false);
    });
  });

  describe('旧角色兼容映射', () => {
    test('只承认原有 admin/process/agent 三种旧登录角色', () => {
      expect(LEGACY_ERP_ROLES).toEqual(['admin', 'process', 'agent']);
      expect(buildLegacyPermissions('supervisor')).toEqual({});
      expect(buildLegacyPermissions('client')).toEqual({});
      expect(buildLegacyPermissions('sub_account')).toEqual({});
      expect(buildLegacyPermissions('sub_department')).toEqual({});
      expect(buildLegacyPermissions(undefined)).toEqual({});
    });

    test.each(['admin', 'process', 'agent'])('%s 仍可进入 ERP，入口功能 scope 固定为 all', (role) => {
      const permissions = buildLegacyPermissions(role);
      expect(permissions[PERMISSIONS.APP_VIEW]).toEqual({ allowed: true, scope: 'all' });
    });

    test('legacy agent 在支持行级范围的业务权限上仍为 self', () => {
      const permissions = buildLegacyPermissions('agent');
      expect(permissions[PERMISSIONS.CONTRACT_VIEW]).toEqual({ allowed: true, scope: 'self' });
      expect(permissions[PERMISSIONS.EXPENSE_VIEW]).toEqual({ allowed: true, scope: 'self' });
    });

    test('旧角色映射只产生 Manifest 已登记编码和合法 scope', () => {
      for (const role of LEGACY_ERP_ROLES) {
        const permissions = buildLegacyPermissions(role);
        for (const [permissionCode, grant] of Object.entries(permissions)) {
          expect(isKnownPermission(permissionCode)).toBe(true);
          expect(ALL_PERMISSION_CODES).toContain(permissionCode);
          expect(grant.allowed).toBe(true);
          expect(VALID_SCOPES).toContain(grant.scope);
        }
      }
    });

    test('原 admin-only 高敏权限不会通过 process/agent 兼容映射放大', () => {
      for (const role of ['process', 'agent']) {
        const permissions = buildLegacyPermissions(role);
        expect(permissions[PERMISSIONS.PAYROLL_PAY]).toBeUndefined();
        expect(permissions[PERMISSIONS.SYSTEM_UPDATE]).toBeUndefined();
        expect(permissions[PERMISSIONS.IMPORT_EXECUTE]).toBeUndefined();
      }
    });
  });

  describe('requirePermission 中间件', () => {
    test('明确授权时放行并注入当前 grant', () => {
      const req = {
        user: {
          permissions: {
            [PERMISSIONS.EXPENSE_APPROVE]: { allowed: true, scope: 'team' }
          }
        }
      };
      const next = jest.fn();

      requirePermission(PERMISSIONS.EXPENSE_APPROVE)(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.permissionCode).toBe(PERMISSIONS.EXPENSE_APPROVE);
      expect(req.permissionGrant).toEqual({ allowed: true, scope: 'team' });
    });

    test.each([
      undefined,
      {},
      { permissions: {} },
      { permissions: { [PERMISSIONS.EXPENSE_APPROVE]: { allowed: false, scope: 'all' } } },
      { permissions: { [PERMISSIONS.EXPENSE_APPROVE]: { allowed: true, scope: 'none' } } },
      { permissions: { [PERMISSIONS.EXPENSE_APPROVE]: { allowed: true, scope: 'root' } } }
    ])('用户授权快照 %p 必须 fail-closed', (user) => {
      const next = jest.fn();

      requirePermission(PERMISSIONS.EXPENSE_APPROVE)({ user }, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    });

    test('路由引用未注册权限编码时立即失败，避免静默放行', () => {
      expect(() => requirePermission('erp.unknown.execute')).toThrow('未注册');
    });
  });

  describe('self/team/all 数据范围', () => {
    const userId = 23;
    const permissionCode = PERMISSIONS.CONTRACT_VIEW;

    test('all 不增加所有者过滤条件', async () => {
      await expect(buildDataScopeFilter({
        user: {
          id: userId,
          permissions: { [permissionCode]: { allowed: true, scope: 'all' } }
        },
        permissionCode
      })).resolves.toEqual({});
    });

    test('self 仅匹配当前用户，并支持自定义 ownerField', async () => {
      await expect(buildDataScopeFilter({
        user: {
          id: userId,
          permissions: { [permissionCode]: { allowed: true, scope: 'self' } }
        },
        permissionCode,
        ownerField: 'created_by'
      })).resolves.toEqual({ created_by: userId });
    });

    test('多属主字段的 self scope 使用 OR，避免项目 created_by/owner_id 漏权或越权', async () => {
      const result = await buildDataScopeFilter({
        user: {
          id: userId,
          permissions: { [permissionCode]: { allowed: true, scope: 'self' } }
        },
        permissionCode,
        ownerFields: ['created_by', 'owner_id']
      });

      expect(result[Op.or]).toEqual([
        { created_by: userId },
        { owner_id: userId }
      ]);
    });

    test('team 使用解析出的团队 ID、去重过滤非法值并包含本人', async () => {
      const resolveTeamUserIds = jest.fn().mockResolvedValue([5, '5', 8, 0, -2, 'bad']);
      const result = await buildDataScopeFilter({
        user: {
          id: userId,
          permissions: { [permissionCode]: { allowed: true, scope: 'team' } }
        },
        permissionCode,
        resolveTeamUserIds
      });

      expect(resolveTeamUserIds).toHaveBeenCalledWith(userId);
      expect(result.owner_id[Op.in]).toEqual([5, 8, userId]);
    });

    test.each([
      ['缺失用户', undefined],
      ['缺失 grant', { id: userId, permissions: {} }],
      ['none', { id: userId, permissions: { [permissionCode]: { allowed: true, scope: 'none' } } }],
      ['非法 scope', { id: userId, permissions: { [permissionCode]: { allowed: true, scope: 'root' } } }]
    ])('%s 返回不可能匹配条件', async (_label, user) => {
      await expect(buildDataScopeFilter({ user, permissionCode })).resolves.toEqual({
        owner_id: DENY_MATCH_VALUE
      });
    });

    test('team 服务无结果、异常格式时都不能退化为 all', async () => {
      const teamUser = {
        id: userId,
        permissions: { [permissionCode]: { allowed: true, scope: 'team' } }
      };

      await expect(buildDataScopeFilter({
        user: teamUser,
        permissionCode,
        teamUserIds: []
      })).resolves.toEqual({ owner_id: DENY_MATCH_VALUE });

      await expect(buildDataScopeFilter({
        user: teamUser,
        permissionCode,
        resolveTeamUserIds: jest.fn().mockResolvedValue(null)
      })).resolves.toEqual({ owner_id: DENY_MATCH_VALUE });
    });

    test('兼容 dataFilter 在缺失用户或 SSO 未指定 permissionCode 时也必须 fail-closed', () => {
      expect(legacyDataFilter({})).toEqual({ owner_id: DENY_MATCH_VALUE });
      expect(legacyDataFilter({
        user: { id: userId, role: 'supervisor', authSource: 'main_sso' }
      })).toEqual({ owner_id: DENY_MATCH_VALUE });
    });
  });
});
