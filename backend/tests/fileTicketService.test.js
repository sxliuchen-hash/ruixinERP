const fs = require('fs');
const path = require('path');

jest.mock('../src/config/redis', () => ({
  set: jest.fn(),
  eval: jest.fn()
}));

const redis = require('../src/config/redis');
const Contract = require('../src/models/Contract');
const { assertFileResourceAccess } = require('../src/services/fileResourceAccessService');
const {
  TICKET_PREFIX,
  TICKET_TTL,
  CONSUME_TICKET_SCRIPT,
  createTicket,
  consumeTicket
} = require('../src/services/fileTicketService');

describe('文件下载一次性票据', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ticketContext = Object.freeze({
    key: 'erp-files/contracts/demo.pdf',
    userId: 17,
    permissionVersion: 8,
    authSource: 'main_sso',
    permissionCode: 'erp.contract.view',
    permissionScope: 'self',
    resourceType: 'contract',
    resourceId: 42
  });

  test('创建票据时绑定用户、权限版本和业务资源，并使用固定前缀和 60 秒 TTL', async () => {
    redis.set.mockResolvedValue('OK');

    const ticket = await createTicket(ticketContext);

    expect(ticket).toMatch(/^[a-f0-9]{48}$/);
    const [redisKey, serialized, mode, ttl] = redis.set.mock.calls[0];
    expect(redisKey).toBe(TICKET_PREFIX + ticket);
    expect(JSON.parse(serialized)).toEqual(ticketContext);
    expect(mode).toBe('EX');
    expect(ttl).toBe(TICKET_TTL);
  });

  test.each([
    ['userId', { ...ticketContext, userId: undefined }],
    ['permissionVersion', { ...ticketContext, permissionVersion: undefined }],
    ['permissionCode', { ...ticketContext, permissionCode: undefined }],
    ['permissionScope', { ...ticketContext, permissionScope: undefined }],
    ['resourceType', { ...ticketContext, resourceType: undefined }],
    ['resourceId', { ...ticketContext, resourceId: undefined }]
  ])('缺少 %s 时拒绝创建未绑定票据', async (_field, payload) => {
    await expect(createTicket(payload)).rejects.toBeDefined();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('消费票据通过单次 Lua eval 原子读取并删除', async () => {
    redis.eval.mockResolvedValue(JSON.stringify(ticketContext));

    await expect(consumeTicket('ticket-1')).resolves.toEqual(ticketContext);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      CONSUME_TICKET_SCRIPT,
      1,
      `${TICKET_PREFIX}ticket-1`
    );
    expect(CONSUME_TICKET_SCRIPT).toMatch(/redis\.call\('GET', KEYS\[1\]\)/);
    expect(CONSUME_TICKET_SCRIPT).toMatch(/redis\.call\('DEL', KEYS\[1\]\)/);
  });

  test('已消费或过期票据返回 null', async () => {
    redis.eval.mockResolvedValue(null);
    await expect(consumeTicket('missing')).resolves.toBeNull();
  });

  test('签发合同附件票据前必须验证资源类型、资源 ID、附件归属和合同 data scope', () => {
    const routeSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'files.js'),
      'utf8'
    );
    const accessSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'fileResourceAccessService.js'),
      'utf8'
    );

    expect(routeSource).toMatch(/resourceType/);
    expect(routeSource).toMatch(/resourceId/);
    expect(routeSource).toMatch(/assertFileResourceAccess/);
    expect(accessSource).toMatch(/CONTRACT_VIEW/);
    expect(accessSource).toMatch(/buildDataScopeFilter/);
    expect(accessSource).toMatch(/attachment_url/);
    expect(accessSource).toMatch(/attachmentKeys\.includes\(normalizedKey\)/);
    expect(routeSource).not.toMatch(/createTicket\s*\(\s*normalizeFileKey\(key\)\s*\)/);
  });

  test('self scope 用户不能为越 scope 合同签票', async () => {
    const findSpy = jest.spyOn(Contract, 'findOne').mockResolvedValue(null);
    const user = {
      id: 17,
      permissions: {
        'erp.contract.view': { allowed: true, scope: 'self' }
      }
    };

    await expect(assertFileResourceAccess({
      user,
      resourceType: 'contract',
      resourceId: 42,
      key: ticketContext.key
    })).rejects.toMatchObject({ statusCode: 403 });

    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 42, owner_id: 17 })
    }));
  });

  test('即使合同在 scope 内，key 不属于该合同也不能签票', async () => {
    jest.spyOn(Contract, 'findOne').mockResolvedValue({
      id: 42,
      attachment_url: JSON.stringify([
        { url: 'https://bucket.cos.ap-shanghai.myqcloud.com/erp-files/contracts/other.pdf' }
      ])
    });
    const user = {
      id: 17,
      permissions: {
        'erp.contract.view': { allowed: true, scope: 'self' }
      }
    };

    await expect(assertFileResourceAccess({
      user,
      resourceType: 'contract',
      resourceId: 42,
      key: ticketContext.key
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
