'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENTS = Object.freeze([
  Object.freeze({
    clientId: 'main-permission-center',
    idVariable: 'ERP_MANIFEST_CLIENT_ID',
    secretVariable: 'ERP_MANIFEST_CLIENT_SECRET',
    purpose: 'manifest-read'
  }),
  Object.freeze({
    clientId: 'main-provisioning',
    idVariable: 'ERP_PROVISION_CLIENT_ID',
    secretVariable: 'ERP_PROVISION_CLIENT_SECRET',
    purpose: 'employee-provisioning'
  })
]);

const SECRET_BYTES = 48;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const args = { output: '', receipt: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!['--output', '--receipt'].includes(token)) {
      throw new Error(`未知参数：${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${token} 缺少路径`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  if (!args.output) throw new Error('必须通过 --output 指定受控凭证文件');
  if (!path.isAbsolute(args.output)) throw new Error('--output 必须是绝对路径');
  if (!args.receipt) args.receipt = `${args.output}.receipt.json`;
  if (!path.isAbsolute(args.receipt)) throw new Error('--receipt 必须是绝对路径');
  if (path.resolve(args.output) === path.resolve(args.receipt)) {
    throw new Error('凭证文件与回执文件不能使用同一路径');
  }
  return {
    output: path.resolve(args.output),
    receipt: path.resolve(args.receipt)
  };
}

function createCredentialBundle({
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
  now = () => new Date()
} = {}) {
  const secrets = CLIENTS.map(() => randomBytes(SECRET_BYTES).toString('base64url'));
  if (new Set(secrets).size !== CLIENTS.length) {
    throw new Error('随机源返回了重复 Secret，已拒绝生成');
  }
  const createdAt = now().toISOString();
  const materialId = `erp-inbound-${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID()}`;
  const clients = CLIENTS.map((client, index) => ({
    ...client,
    secret: secrets[index],
    secretSha256: sha256(secrets[index])
  }));
  return { materialId, createdAt, clients };
}

function buildEnvContent(bundle) {
  const lines = [
    '# ERP inbound client credentials. Do not commit or print this file.',
    `# materialId=${bundle.materialId}`,
    `# createdAt=${bundle.createdAt}`
  ];
  for (const client of bundle.clients) {
    lines.push(`${client.idVariable}=${client.clientId}`);
    lines.push(`${client.secretVariable}=${client.secret}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildReceipt(bundle) {
  return {
    schemaVersion: 1,
    materialId: bundle.materialId,
    createdAt: bundle.createdAt,
    clients: bundle.clients.map(({ clientId, purpose, secretSha256 }) => ({
      clientId,
      purpose,
      secretSha256
    }))
  };
}

function ensurePrivateDirectory(directory, fsApi = fs) {
  fsApi.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fsApi.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`输出目录必须是普通目录：${directory}`);
  }
  if (process.platform !== 'win32') fsApi.chmodSync(directory, 0o700);
}

function assertTargetAbsent(target, fsApi = fs) {
  if (fsApi.existsSync(target)) {
    throw new Error(`目标已存在，拒绝覆盖或轮换：${target}`);
  }
}

function writePrivateFile(target, content, fsApi = fs) {
  ensurePrivateDirectory(path.dirname(target), fsApi);
  assertTargetAbsent(target, fsApi);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.part`;
  try {
    fsApi.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') fsApi.chmodSync(temporary, 0o600);
    fsApi.renameSync(temporary, target);
    if (process.platform !== 'win32') fsApi.chmodSync(target, 0o600);
  } catch (error) {
    if (fsApi.existsSync(temporary)) fsApi.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeCredentialBundle(paths, bundle, fsApi = fs) {
  assertTargetAbsent(paths.output, fsApi);
  assertTargetAbsent(paths.receipt, fsApi);
  writePrivateFile(paths.output, buildEnvContent(bundle), fsApi);
  try {
    writePrivateFile(
      paths.receipt,
      `${JSON.stringify(buildReceipt(bundle), null, 2)}\n`,
      fsApi
    );
  } catch (error) {
    // 只清理由本次调用刚创建的精确凭证文件，避免留下无回执材料。
    fsApi.rmSync(paths.output, { force: true });
    throw error;
  }
}

function buildSafeSummary(paths, bundle) {
  return {
    success: true,
    materialId: bundle.materialId,
    receiptPath: paths.receipt,
    clients: bundle.clients.map(({ clientId, purpose, secretSha256 }) => ({
      clientId,
      purpose,
      secretSha256
    }))
  };
}

function main(argv = process.argv.slice(2)) {
  const paths = parseArgs(argv);
  const bundle = createCredentialBundle();
  writeCredentialBundle(paths, bundle);
  process.stdout.write(`${JSON.stringify(buildSafeSummary(paths, bundle))}\n`);
  return { paths, bundle };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`凭证生成失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CLIENTS,
  SECRET_BYTES,
  sha256,
  parseArgs,
  createCredentialBundle,
  buildEnvContent,
  buildReceipt,
  assertTargetAbsent,
  writePrivateFile,
  writeCredentialBundle,
  buildSafeSummary,
  main
};
