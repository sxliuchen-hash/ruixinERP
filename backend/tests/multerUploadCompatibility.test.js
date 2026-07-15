'use strict';

const express = require('express');
const http = require('http');

const contractsRouter = require('../src/routes/contracts');
const importRouter = require('../src/routes/import');
const inventoryRouter = require('../src/routes/inventory');
const reconciliationRouter = require('../src/routes/reconciliation');
const performanceImportRouter = require('../src/routes/performanceImport');

function getMulterMiddleware(router, routePath) {
  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === routePath && layer.route.methods.post
  );
  if (!routeLayer) {
    throw new Error(`找不到 POST ${routePath} 路由`);
  }

  const multerLayer = routeLayer.route.stack.find(
    (layer) => layer.name === 'multerMiddleware'
  );
  if (!multerLayer) {
    throw new Error(`POST ${routePath} 未配置 multerMiddleware`);
  }
  return multerLayer.handle;
}

function buildMultipartBody({ boundary, filename, mimetype, content }) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`,
      'utf8'
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  ]);
}

async function postMultipart(middleware, file) {
  const app = express();
  app.post('/upload', middleware, (req, res) => {
    res.status(200).json({
      filename: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size,
      isBuffer: Buffer.isBuffer(req.file?.buffer)
    });
  });
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(400).json({
      code: error.code || null,
      message: error.message
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const boundary = `----erp-multer-v2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = buildMultipartBody({ boundary, ...file });

  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ statusCode: response.statusCode, payload });
        });
      });
      request.once('error', reject);
      request.end(body);
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('Multer 2 实际上传路由兼容性', () => {
  const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const cases = [
    ['合同附件', contractsRouter, '/:id/attachment', 'contract.pdf', 'application/pdf'],
    ['历史导入', importRouter, '/validate/:type', 'history.xlsx', excelMime],
    ['库存导入', inventoryRouter, '/batch-import/validate', 'inventory.xlsx', excelMime],
    ['银行对账', reconciliationRouter, '/upload', 'statement.xlsx', excelMime],
    ['业绩导入', performanceImportRouter, '/validate', 'performance.xlsx', excelMime]
  ];

  test.each(cases)(
    '%s 路由继续使用内存 Buffer 接收合法 multipart 文件',
    async (name, router, routePath, filename, mimetype) => {
      const middleware = getMulterMiddleware(router, routePath);
      const content = Buffer.from('0123456789');

      const response = await postMultipart(middleware, {
        filename,
        mimetype,
        content
      });

      expect(response).toEqual({
        statusCode: 200,
        payload: {
          filename,
          mimetype,
          size: content.length,
          isBuffer: true
        }
      });
    }
  );

  test('库存导入拒绝非 Excel 扩展名', async () => {
    const middleware = getMulterMiddleware(inventoryRouter, '/batch-import/validate');
    const response = await postMultipart(middleware, {
      filename: 'inventory.txt',
      mimetype: 'text/plain',
      content: Buffer.from('not-an-excel-file')
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.code).toBeNull();
    expect(response.payload.message).toBe('仅支持 .xlsx 或 .xls 格式');
  });

  test('库存导入拒绝超过 10MB 的文件并返回 Multer 限额代码', async () => {
    const middleware = getMulterMiddleware(inventoryRouter, '/batch-import/validate');
    const response = await postMultipart(middleware, {
      filename: 'too-large.xlsx',
      mimetype: excelMime,
      content: Buffer.alloc((10 * 1024 * 1024) + 1, 0x61)
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.code).toBe('LIMIT_FILE_SIZE');
    expect(response.payload.message).toBe('File too large');
  }, 15000);
});
