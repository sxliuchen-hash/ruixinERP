'use strict';

require('dotenv').config();
const {
  ReleasePrecheckError,
  loadReleasePrecheckConfig,
  runReleasePrecheck
} = require('../src/services/releasePrecheckService');

function readOption(args, index, name) {
  const argument = args[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 1 };
  if (argument === name) {
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
      throw new ReleasePrecheckError('RELEASE_ARGUMENT_INVALID', `${name} 缺少值`);
    }
    return { value: args[index + 1], consumed: 2 };
  }
  return null;
}

function parseArgs(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length;) {
    const expectedCommit = readOption(args, index, '--expected-commit');
    if (expectedCommit) {
      if (options.expectedCommit !== undefined) {
        throw new ReleasePrecheckError('RELEASE_ARGUMENT_DUPLICATE', '--expected-commit 不得重复');
      }
      options.expectedCommit = expectedCommit.value;
      index += expectedCommit.consumed;
      continue;
    }
    const nginxCandidate = readOption(args, index, '--nginx-candidate');
    if (nginxCandidate) {
      if (options.nginxCandidate !== undefined) {
        throw new ReleasePrecheckError('RELEASE_ARGUMENT_DUPLICATE', '--nginx-candidate 不得重复');
      }
      options.nginxCandidate = nginxCandidate.value;
      index += nginxCandidate.consumed;
      continue;
    }
    if (args[index] === '--allow-dirty-development') {
      if (options.allowDirtyDevelopment) {
        throw new ReleasePrecheckError('RELEASE_ARGUMENT_DUPLICATE', '--allow-dirty-development 不得重复');
      }
      options.allowDirtyDevelopment = true;
      index += 1;
      continue;
    }
    throw new ReleasePrecheckError('RELEASE_ARGUMENT_UNKNOWN', `不支持的参数：${args[index]}`);
  }
  return options;
}

async function main({
  args = process.argv.slice(2),
  env = process.env,
  output = console,
  execute = runReleasePrecheck
} = {}) {
  try {
    const options = parseArgs(args);
    const config = loadReleasePrecheckConfig({ env, ...options });
    const result = await execute({ config });
    output.log('✓ 只读发布前检查通过');
    output.log(`✓ Commit ${result.commit}`);
    output.log(`✓ Nginx candidate ${result.nginxCandidate}`);
    output.log(`✓ 备份卷可用空间 ${result.backupDiskFreeBytes} 字节`);
    output.log('✓ 配置、数据库结构和 Redis 只读检查通过');
    for (const warning of result.warnings || []) output.log(`• ${warning}`);
    return 0;
  } catch (error) {
    const safeError = error instanceof ReleasePrecheckError
      ? error
      : new ReleasePrecheckError('RELEASE_PRECHECK_UNEXPECTED', '只读发布前检查发生未预期错误');
    output.error(`✗ [${safeError.code}] ${safeError.message}`);
    for (const item of safeError.issues || []) {
      output.error(`  - [${item.code}] ${item.message}`);
    }
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  readOption,
  parseArgs,
  main
};
