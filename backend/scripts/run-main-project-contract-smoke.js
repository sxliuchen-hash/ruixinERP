'use strict';

require('dotenv').config();
const {
  runMainProjectContractSmoke: executeContractSmoke,
  AUTHORIZATION_CODE_ENV,
  SSO_STATE_ENV
} = require('../src/services/mainProjectContractSmokeService');

function redactSensitiveText(value, env = process.env) {
  let output = String(value || '');
  const sensitiveValues = [
    env.ERP_SSO_CLIENT_SECRET,
    env.MAIN_API_CLIENT_SECRET,
    env[AUTHORIZATION_CODE_ENV],
    env[SSO_STATE_ENV]
  ].filter((item) => typeof item === 'string' && item.length >= 4);

  for (const sensitive of sensitiveValues) {
    output = output.split(sensitive).join('[REDACTED]');
  }
  return output.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
}

async function runMainProjectContractSmoke({
  env = process.env,
  output = console,
  httpClient,
  config,
  assertionVerifier
} = {}) {
  const result = await executeContractSmoke({
    env,
    httpClient,
    config,
    assertionVerifier
  });
  output.log(`✓ 主项目只读契约检查通过：用户 ${result.userId}`);
  output.log(`✓ team-scope：${result.teamUserIds.length} 个用户（包含本人）`);
  output.log(`✓ permission-version：${result.permissionVersion}`);
  if (result.sso) {
    output.log(`✓ SSO exchange：RS256 assertion 验证通过，用户 ${result.sso.userId}，权限版本 ${result.sso.permissionVersion}`);
  } else {
    output.log(`○ 未配置 ${AUTHORIZATION_CODE_ENV}，本次未消费一次性 Code`);
  }

  return {
    ok: true,
    userId: result.userId,
    teamUserCount: result.teamUserIds.length,
    permissionVersion: result.permissionVersion,
    sso: result.sso
  };
}

async function main({
  env = process.env,
  output = console,
  httpClient,
  config,
  assertionVerifier,
  runner = runMainProjectContractSmoke
} = {}) {
  try {
    await runner({ env, output, httpClient, config, assertionVerifier });
    return 0;
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error?.code || '')
      ? error.code
      : 'MAIN_CONTRACT_SMOKE_UNEXPECTED_ERROR';
    const rawMessage = error?.isOperational
      ? error.message
      : '主项目契约烟雾检查执行异常';
    output.error(`✗ [${code}] ${redactSensitiveText(rawMessage, env)}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  redactSensitiveText,
  runMainProjectContractSmoke,
  main
};
