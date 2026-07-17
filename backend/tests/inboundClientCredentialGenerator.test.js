'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CLIENTS,
  SECRET_BYTES,
  parseArgs,
  createCredentialBundle,
  buildEnvContent,
  buildReceipt,
  writeCredentialBundle,
  buildSafeSummary
} = require('../scripts/generate-inbound-client-credentials');

describe('ERP 入站 Client 受控凭证生成器', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-inbound-credentials-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('固定生成两套互不复用的强随机 Secret 和可审计指纹', () => {
    let call = 0;
    const bundle = createCredentialBundle({
      randomBytes: (size) => {
        expect(size).toBe(SECRET_BYTES);
        call += 1;
        return Buffer.alloc(size, call);
      },
      randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
      now: () => new Date('2026-07-17T01:02:03.000Z')
    });

    expect(bundle.materialId).toBe(
      'erp-inbound-20260717010203-123e4567-e89b-42d3-a456-426614174000'
    );
    expect(bundle.clients.map((client) => client.clientId)).toEqual([
      'main-permission-center',
      'main-provisioning'
    ]);
    expect(new Set(bundle.clients.map((client) => client.secret)).size).toBe(2);
    for (const client of bundle.clients) {
      expect(client.secret).toHaveLength(64);
      expect(client.secretSha256).toBe(
        crypto.createHash('sha256').update(client.secret).digest('hex')
      );
    }
  });

  test('回执和终端安全摘要不包含 Secret，凭证文件包含固定变量名', () => {
    const bundle = createCredentialBundle();
    const envContent = buildEnvContent(bundle);
    const receipt = buildReceipt(bundle);
    const summary = buildSafeSummary({ receipt: 'controlled.receipt.json' }, bundle);

    for (const client of bundle.clients) {
      expect(envContent).toContain(`${client.idVariable}=${client.clientId}`);
      expect(envContent).toContain(`${client.secretVariable}=${client.secret}`);
      expect(JSON.stringify(receipt)).not.toContain(client.secret);
      expect(JSON.stringify(summary)).not.toContain(client.secret);
      expect(JSON.stringify(receipt)).toContain(client.secretSha256);
    }
    expect(envContent).toContain('Do not commit or print this file');
  });

  test('原子写入受控文件与回执并拒绝覆盖已有材料', () => {
    const output = path.join(tempDir, 'erp-inbound.env');
    const receipt = path.join(tempDir, 'erp-inbound.receipt.json');
    const paths = { output, receipt };
    const bundle = createCredentialBundle();

    writeCredentialBundle(paths, bundle);
    expect(fs.readFileSync(output, 'utf8')).toBe(buildEnvContent(bundle));
    expect(JSON.parse(fs.readFileSync(receipt, 'utf8'))).toEqual(buildReceipt(bundle));
    expect(() => writeCredentialBundle(paths, createCredentialBundle()))
      .toThrow('拒绝覆盖或轮换');
  });

  test.each([
    [[], '必须通过 --output'],
    [['--output', 'relative.env'], '--output 必须是绝对路径'],
    [['--output'], '--output 缺少路径'],
    [['--unknown', 'value'], '未知参数'],
    [['--output', path.join(os.tmpdir(), 'same.env'), '--receipt', path.join(os.tmpdir(), 'same.env')], '不能使用同一路径']
  ])('非法 CLI 参数 %# fail-closed', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  test('Client 固定用途不能被外部参数改写', () => {
    expect(CLIENTS).toEqual([
      expect.objectContaining({ clientId: 'main-permission-center', purpose: 'manifest-read' }),
      expect.objectContaining({ clientId: 'main-provisioning', purpose: 'employee-provisioning' })
    ]);
  });
});
