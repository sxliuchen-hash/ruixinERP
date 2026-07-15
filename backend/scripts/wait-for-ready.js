'use strict';

require('dotenv').config();
const {
  ReadyWaitError,
  loadReadyWaitConfig,
  waitForReady
} = require('../src/services/readyWaitService');

function readOption(args, index, name) {
  const argument = args[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 1 };
  if (argument === name) {
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
      throw new ReadyWaitError('READY_ARGUMENT_INVALID', `${name} 缺少值`);
    }
    return { value: args[index + 1], consumed: 2 };
  }
  return null;
}

function parseArgs(args = process.argv.slice(2)) {
  const options = {};
  const hosts = [];
  for (let index = 0; index < args.length;) {
    const url = readOption(args, index, '--url');
    if (url) {
      if (options.url !== undefined) {
        throw new ReadyWaitError('READY_ARGUMENT_DUPLICATE', '--url 不得重复');
      }
      options.url = url.value;
      index += url.consumed;
      continue;
    }
    const host = readOption(args, index, '--allow-host');
    if (host) {
      hosts.push(host.value);
      index += host.consumed;
      continue;
    }
    throw new ReadyWaitError('READY_ARGUMENT_UNKNOWN', `不支持的参数：${args[index]}`);
  }
  if (hosts.length > 0) options.allowedHosts = hosts;
  return options;
}

async function main({
  args = process.argv.slice(2),
  env = process.env,
  output = console,
  execute = waitForReady
} = {}) {
  try {
    const options = parseArgs(args);
    const config = loadReadyWaitConfig({ env, ...options });
    output.log(`等待 ERP ready：${config.safeTarget}`);
    const result = await execute({
      config,
      onAttempt(attempt) {
        if (!attempt.ready) {
          const suffix = Number.isInteger(attempt.status) ? ` HTTP ${attempt.status}` : '';
          output.log(`• 第 ${attempt.attempt} 次未就绪：[${attempt.code}]${suffix}`);
        }
      }
    });
    output.log(
      `✓ ERP ready 已连续通过 ${result.consecutiveSuccesses} 次（共 ${result.attempts} 次，${result.elapsedMs}ms）`
    );
    return 0;
  } catch (error) {
    const safeError = error instanceof ReadyWaitError
      ? error
      : new ReadyWaitError('READY_WAIT_UNEXPECTED', 'ready 等待发生未预期错误');
    output.error(`✗ [${safeError.code}] ${safeError.message}`);
    if (safeError.details?.lastCode) {
      const status = Number.isInteger(safeError.details.lastStatus)
        ? ` HTTP ${safeError.details.lastStatus}`
        : '';
      output.error(`  最后结果：[${safeError.details.lastCode}]${status}`);
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
