const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const inventoryService = require('../src/services/inventoryService');
const projectService = require('../src/services/projectService');

const {
  normalizeCreatedByFilter,
  buildCreatedBySqlScope
} = inventoryService;

function extractAsyncMethod(source, methodName) {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) return '';
  const next = source.indexOf('\n  async ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe('Inventory / Project permission scope 执行', () => {
  describe('Inventory created_by scope', () => {
    test('SSO all/self/team dataFilter 优先于角色，精确归一化', () => {
      expect(normalizeCreatedByFilter({}, 7, 'supervisor')).toEqual({});
      expect(normalizeCreatedByFilter({ created_by: 7 }, 7, 'supervisor'))
        .toEqual({ created_by: 7 });

      const team = normalizeCreatedByFilter({
        created_by: { [Op.in]: [7, '8', 8, 0, 'bad'] }
      }, 7, 'supervisor');
      expect(team.created_by[Op.in]).toEqual([7, 8]);
    });

    test('未知 SSO 角色没有 dataFilter 时拒绝，不能默认全量', () => {
      expect(normalizeCreatedByFilter(undefined, 7, 'supervisor')).toEqual({ created_by: -1 });
      expect(normalizeCreatedByFilter(undefined, 7, 'client')).toEqual({ created_by: -1 });
      expect(normalizeCreatedByFilter({ unexpected: true }, 7, 'supervisor'))
        .toEqual({ created_by: -1 });
    });

    test('legacy fallback 仅保留既有 agent=self、admin/process=all', () => {
      expect(normalizeCreatedByFilter(undefined, 7, 'agent')).toEqual({ created_by: 7 });
      expect(normalizeCreatedByFilter(undefined, 7, 'admin')).toEqual({});
      expect(normalizeCreatedByFilter(undefined, 7, 'process')).toEqual({});
    });

    test('raw SQL scope 对 all/self/team/deny 生成对应 clause 和 replacements', () => {
      expect(buildCreatedBySqlScope({}, 7, 'supervisor')).toEqual({
        clause: '',
        replacements: {}
      });
      expect(buildCreatedBySqlScope({ created_by: 7 }, 7, 'supervisor')).toEqual({
        clause: 'AND created_by = :scopeUserId',
        replacements: { scopeUserId: 7 }
      });

      const team = buildCreatedBySqlScope({
        created_by: { [Op.in]: [7, 8] }
      }, 7, 'supervisor');
      expect(team).toEqual({
        clause: 'AND created_by IN (:scopeUserIds)',
        replacements: { scopeUserIds: [7, 8] }
      });

      expect(buildCreatedBySqlScope(undefined, 7, 'supervisor')).toEqual({
        clause: 'AND created_by = :scopeUserId',
        replacements: { scopeUserId: -1 }
      });
    });
  });

  describe('Project created_by OR owner_id scope', () => {
    test('self/team/all dataFilter 原样进入 service，未知角色无 filter 时拒绝', () => {
      const selfFilter = {
        [Op.or]: [{ created_by: 7 }, { owner_id: 7 }]
      };
      const teamFilter = {
        [Op.or]: [
          { created_by: { [Op.in]: [7, 8] } },
          { owner_id: { [Op.in]: [7, 8] } }
        ]
      };

      expect(projectService._resolveScopeFilter(7, 'supervisor', {})).toEqual({});
      expect(projectService._resolveScopeFilter(7, 'supervisor', selfFilter)).toEqual(selfFilter);
      expect(projectService._resolveScopeFilter(7, 'supervisor', teamFilter)).toEqual(teamFilter);
      expect(projectService._resolveScopeFilter(7, 'supervisor', undefined)).toEqual({ id: -1 });
      expect(projectService._resolveScopeFilter(7, 'client', undefined)).toEqual({ id: -1 });
    });
  });

  describe('路由、raw SQL 与高风险动作静态覆盖', () => {
    const inventoryServiceSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'inventoryService.js'),
      'utf8'
    );
    const inventoryRouteSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'inventory.js'),
      'utf8'
    );
    const projectRouteSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'projects.js'),
      'utf8'
    );

    test.each(['getOverview', 'getExpiring', 'getSoldStats', 'getSoldAnalytics'])(
      'Inventory.%s 的 raw SQL 注入 buildCreatedBySqlScope',
      (methodName) => {
        const method = extractAsyncMethod(inventoryServiceSource, methodName);
        expect(method).toMatch(/buildCreatedBySqlScope\s*\(/);
        expect(method).toMatch(/scope\.(clause|replacements)|userFilter/);
      }
    );

    test.each(['batchDelete', 'unsell'])(
      'Inventory.%s 不再硬编码 admin/agent，权限由路由决定',
      (methodName) => {
        const method = extractAsyncMethod(inventoryServiceSource, methodName);
        expect(method).not.toMatch(/userRole\s*[!=]==?\s*['"](admin|agent)['"]/);
        expect(method).toMatch(/normalizeCreatedByFilter\s*\(/);
      }
    );

    test('Inventory 高风险路由使用独立权限并附加 scope', () => {
      expect(inventoryRouteSource).toMatch(/requirePermission\(PERMISSIONS\.INVENTORY_BATCH_DELETE\)/);
      expect(inventoryRouteSource).toMatch(/requirePermission\(PERMISSIONS\.INVENTORY_UNSELL\)/);
      expect(inventoryRouteSource).toMatch(/inventoryScope\(PERMISSIONS\.INVENTORY_BATCH_DELETE\)/);
      expect(inventoryRouteSource).toMatch(/inventoryScope\(PERMISSIONS\.INVENTORY_UNSELL\)/);
      expect(inventoryRouteSource).not.toMatch(/require(Admin|ErpAccess)\s*\(/);
    });

    test('Project scope 明确声明 created_by OR owner_id', () => {
      expect(projectRouteSource).toMatch(/ownerFields:\s*\['created_by',\s*'owner_id'\]/);
      expect(projectRouteSource).toMatch(/projectScope\(PERMISSIONS\.PROJECT_VIEW\)/);
      expect(projectRouteSource).toMatch(/projectScope\(PERMISSIONS\.PROJECT_UPDATE\)/);
      expect(projectRouteSource).toMatch(/projectScope\(PERMISSIONS\.PROJECT_DELETE\)/);
    });
  });
});
