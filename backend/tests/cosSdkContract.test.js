'use strict';

const mockPutObject = jest.fn();
const mockGetObject = jest.fn();
const mockCosConstructor = jest.fn(() => ({
  putObject: mockPutObject,
  getObject: mockGetObject
}));
const mockAssertFileResourceAccess = jest.fn();

jest.mock('cos-nodejs-sdk-v5', () => mockCosConstructor);
jest.mock('../src/services/fileResourceAccessService', () => {
  const actual = jest.requireActual('../src/services/fileResourceAccessService');
  return {
    ...actual,
    assertFileResourceAccess: mockAssertFileResourceAccess
  };
});

const ActualCOS = jest.requireActual('cos-nodejs-sdk-v5');
const wechatFileService = require('../src/services/wechat/wechatFileService');
const filesRouter = require('../src/routes/files');

describe('COS Node.js SDK 3 callback API 契约', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.COS_SECRET_ID = 'test-secret-id';
    process.env.COS_SECRET_KEY = 'test-secret-key';
    process.env.COS_BUCKET = 'erp-test-123456';
    process.env.COS_REGION = 'ap-test';
    wechatFileService._cos = null;
  });

  afterEach(() => {
    jest.clearAllMocks();
    wechatFileService._cos = null;
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('实际 SDK 构造器继续暴露 putObject/getObject callback 方法', () => {
    const client = new ActualCOS({
      SecretId: 'surface-test-id',
      SecretKey: 'surface-test-key'
    });

    expect(typeof client.putObject).toBe('function');
    expect(typeof client.getObject).toBe('function');
  });

  test('企微附件上传按 SDK callback 契约传递 Buffer 和 ContentType', async () => {
    mockPutObject.mockImplementationOnce((params, callback) => {
      callback(null, { statusCode: 200 });
    });

    await expect(
      wechatFileService._uploadToCos(
        Buffer.from('cos-contract'),
        'erp-files/contracts/SP-1/attachment.txt',
        'text/plain'
      )
    ).resolves.toBe(
      'https://erp-test-123456.cos.ap-test.myqcloud.com/' +
      'erp-files/contracts/SP-1/attachment.txt'
    );

    expect(mockCosConstructor).toHaveBeenCalledWith({
      SecretId: 'test-secret-id',
      SecretKey: 'test-secret-key'
    });
    expect(mockPutObject).toHaveBeenCalledWith({
      Bucket: 'erp-test-123456',
      Region: 'ap-test',
      Key: 'erp-files/contracts/SP-1/attachment.txt',
      Body: expect.any(Buffer),
      ContentType: 'text/plain'
    }, expect.any(Function));
  });

  test('文件代理按 getObject callback 的 data.Body 返回对象内容', async () => {
    mockAssertFileResourceAccess.mockResolvedValueOnce({
      key: 'erp-files/contracts/SP-1/attachment.pdf'
    });
    const pdfBody = Buffer.from('%PDF mock body');
    mockGetObject.mockImplementationOnce((params, callback) => {
      callback(null, { Body: pdfBody });
    });

    const downloadLayer = filesRouter.stack.find(
      (layer) => layer.route?.path === '/download'
    );
    const downloadHandler = downloadLayer.route.stack.at(-1).handle;
    const req = {
      query: {
        key: 'erp-files/contracts/SP-1/attachment.pdf',
        resourceType: 'contract',
        resourceId: '1'
      },
      user: { id: 7 }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn()
    };
    const next = jest.fn();

    await downloadHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockGetObject).toHaveBeenCalledWith({
      Bucket: 'erp-test-123456',
      Region: 'ap-test',
      Key: 'erp-files/contracts/SP-1/attachment.pdf'
    }, expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.end).toHaveBeenCalledWith(pdfBody);
  });
});
