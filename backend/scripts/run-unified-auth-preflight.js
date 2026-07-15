'use strict';

require('dotenv').config();
const { runUnifiedAuthPreflight } = require('../src/services/unifiedAuthPreflightService');

async function run() {
  try {
    const result = await runUnifiedAuthPreflight();
    console.log('✓ 统一认证生产配置预检通过');
    console.log(`✓ Manifest ${result.manifest.version}：${result.manifest.permissionCount} 权限 / ${result.manifest.routeCount} 路由`);
    console.log(result.employeeIndexChecked
      ? '✓ 数据库业务唯一约束检查通过'
      : '○ 本次未连接数据库检查业务唯一约束');
    for (const warning of result.warnings) console.log(`○ ${warning}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    for (const issue of error.issues || []) {
      console.error(`  - [${issue.code}] ${issue.message}`);
    }
    process.exitCode = 1;
  }
}

run();
