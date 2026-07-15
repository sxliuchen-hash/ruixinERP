const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const notificationService = require('../src/services/notificationService');
const Notification = require('../src/models/Notification');

const {
  normalizeNotificationFilter,
  normalizeNotificationWriteFilter
} = notificationService;

describe('Notification 主项目 scope 语义', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('self 只匹配当前 user_id', () => {
    expect(normalizeNotificationFilter({ user_id: 17 }, 17, 'supervisor'))
      .toEqual({ user_id: 17 });
  });

  test('all 只扩大到本人 + user_id=NULL 系统广播，不读取其他用户私信', () => {
    const filter = normalizeNotificationFilter({}, 17, 'supervisor');
    expect(filter[Op.or]).toEqual([
      { user_id: 17 },
      { user_id: null }
    ]);
    expect(filter[Op.or]).not.toContainEqual({ user_id: 18 });
  });

  test('缺失/非法 SSO filter 与未知角色必须 fail-closed', () => {
    expect(normalizeNotificationFilter(undefined, 17, 'supervisor')).toEqual({ user_id: -1 });
    expect(normalizeNotificationFilter({ unexpected: true }, 17, 'supervisor'))
      .toEqual({ user_id: -1 });
    expect(normalizeNotificationFilter(undefined, 17, 'client')).toEqual({ user_id: -1 });
  });

  test('legacy 回退保持 admin=本人+广播、process/agent=本人', () => {
    expect(normalizeNotificationFilter(undefined, 17, 'admin')[Op.or]).toEqual([
      { user_id: 17 },
      { user_id: null }
    ]);
    expect(normalizeNotificationFilter(undefined, 17, 'process')).toEqual({ user_id: 17 });
    expect(normalizeNotificationFilter(undefined, 17, 'agent')).toEqual({ user_id: 17 });
  });

  test('写操作即使拥有 all scope 也只能匹配当前用户私信', () => {
    expect(normalizeNotificationWriteFilter({}, 17, 'supervisor')).toEqual({ user_id: 17 });
    expect(normalizeNotificationWriteFilter(undefined, 17, 'admin')).toEqual({ user_id: 17 });
    expect(normalizeNotificationWriteFilter({ unexpected: true }, 17, 'supervisor'))
      .toEqual({ user_id: -1 });
  });

  test('列表、计数、已读与删除接口都挂载相同 permission data scope', () => {
    const routeSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'notifications.js'),
      'utf8'
    );
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'notificationService.js'),
      'utf8'
    );

    expect((routeSource.match(/attachPermissionDataScope\s*\(/g) || []).length).toBe(5);
    expect(routeSource).toMatch(/NOTIFICATION_VIEW[\s\S]*ownerField:\s*'user_id'/);
    expect(routeSource).toMatch(/NOTIFICATION_UPDATE[\s\S]*ownerField:\s*'user_id'/);
    expect(routeSource).toMatch(/NOTIFICATION_DELETE[\s\S]*ownerField:\s*'user_id'/);

    for (const methodName of ['getList']) {
      const start = serviceSource.indexOf(`async ${methodName}(`);
      const next = serviceSource.indexOf('\n  async ', start + 1);
      const method = serviceSource.slice(start, next < 0 ? serviceSource.length : next);
      expect(method).toMatch(/normalizeNotificationFilter\s*\(/);
    }
    const unreadStart = serviceSource.indexOf('async getUnreadCount(');
    const unreadNext = serviceSource.indexOf('\n  async ', unreadStart + 1);
    const unreadMethod = serviceSource.slice(unreadStart, unreadNext);
    expect(unreadMethod).toMatch(/normalizeNotificationWriteFilter\s*\(/);
    for (const methodName of ['markRead', 'markAllRead', 'remove']) {
      const start = serviceSource.indexOf(`async ${methodName}(`);
      const next = serviceSource.indexOf('\n  async ', start + 1);
      const method = serviceSource.slice(start, next < 0 ? serviceSource.length : next);
      expect(method).toMatch(/normalizeNotificationWriteFilter\s*\(/);
    }
    expect(serviceSource).not.toMatch(/findByPk\s*\(id\)/);
  });

  test('all 用户标记全部已读时只更新个人消息，不修改 user_id=NULL 共享广播', async () => {
    const updateSpy = jest.spyOn(Notification, 'update').mockResolvedValue([2]);

    await expect(notificationService.markAllRead(17, 'supervisor', {}))
      .resolves.toEqual({ affected: 2 });

    const where = updateSpy.mock.calls[0][1].where;
    expect(where).toMatchObject({ user_id: 17, is_read: 0 });
    expect(where[Op.or]).toBeUndefined();
  });

  test('未读数量只统计个人消息，共享广播不会形成无法清除的永久红点', async () => {
    const countSpy = jest.spyOn(Notification, 'count').mockResolvedValue(3);

    await expect(notificationService.getUnreadCount(17, 'supervisor', {})).resolves.toBe(3);

    const where = countSpy.mock.calls[0][0].where;
    expect(where).toEqual({ user_id: 17, is_read: 0 });
  });

  test('列表中的共享广播以只读且已读视图返回，不修改数据库共享状态', async () => {
    jest.spyOn(Notification, 'findAndCountAll').mockResolvedValue({
      rows: [
        { toJSON: () => ({ id: 1, user_id: null, is_read: 0, title: '广播' }) },
        { toJSON: () => ({ id: 2, user_id: 17, is_read: 0, title: '私信' }) }
      ],
      count: 2
    });

    const result = await notificationService.getList({}, 17, 'supervisor', {});

    expect(result.list[0]).toMatchObject({ id: 1, is_read: 1, readonly: true });
    expect(result.list[1]).toMatchObject({ id: 2, is_read: 0, readonly: false });
  });

  test.each([
    ['markRead', () => notificationService.markRead(9, 17, 'supervisor', {})],
    ['remove', () => notificationService.remove(9, 17, 'supervisor', {})]
  ])('%s 查询只允许命中个人消息，不能修改或删除共享广播', async (_method, invoke) => {
    const findSpy = jest.spyOn(Notification, 'findOne').mockResolvedValue(null);

    await expect(invoke()).rejects.toMatchObject({ statusCode: 404 });

    const where = findSpy.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 9, user_id: 17 });
    expect(where[Op.or]).toBeUndefined();
  });

  test.each([
    ['markRead', 'update', () => notificationService.markRead(9, 17, 'supervisor', {})],
    ['remove', 'destroy', () => notificationService.remove(9, 17, 'supervisor', {})]
  ])('%s 即使意外读取到共享广播也必须拒绝写入', async (_method, mutation, invoke) => {
    const broadcast = {
      id: 9,
      user_id: null,
      is_read: 0,
      update: jest.fn(),
      destroy: jest.fn()
    };
    jest.spyOn(Notification, 'findOne').mockResolvedValue(broadcast);

    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(broadcast[mutation]).not.toHaveBeenCalled();
  });
});
