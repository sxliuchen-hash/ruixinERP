'use strict';

const {
  inspectPayrollSchema,
  buildPayrollSchemaMigrationPlan
} = require('../../scripts/run-payroll-schema-migration');

class PayrollSchemaGuardError extends Error {
  constructor(message, code, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PayrollSchemaGuardError';
    this.code = code;
    if (Number.isInteger(options.pendingStatementCount)) {
      this.pendingStatementCount = options.pendingStatementCount;
    }
  }
}

/**
 * 只读验证薪酬相关表是否已经完成显式迁移。
 *
 * inspectPayrollSchema 仅执行 SHOW/SELECT，buildPayrollSchemaMigrationPlan
 * 只在内存中生成计划。本门禁绝不执行计划中的 DDL；计划非空即拒绝启动，
 * 由运维显式运行 npm run migrate:payroll-schema 后再重试。
 */
async function assertPayrollSchemaReady(sequelize, {
  inspectSchema = inspectPayrollSchema,
  buildMigrationPlan = buildPayrollSchemaMigrationPlan
} = {}) {
  let snapshot;
  try {
    snapshot = await inspectSchema(sequelize);
  } catch (error) {
    throw new PayrollSchemaGuardError(
      '薪酬数据库结构读取失败',
      'PAYROLL_SCHEMA_INSPECTION_FAILED',
      { cause: error }
    );
  }

  let pendingStatements;
  try {
    pendingStatements = buildMigrationPlan(snapshot);
  } catch (error) {
    throw new PayrollSchemaGuardError(
      '薪酬数据库结构存在冲突',
      'PAYROLL_SCHEMA_CONFLICT',
      { cause: error }
    );
  }

  if (!Array.isArray(pendingStatements)) {
    throw new PayrollSchemaGuardError(
      '薪酬数据库结构检查器返回了非法结果',
      'PAYROLL_SCHEMA_GUARD_INVALID_RESULT'
    );
  }

  if (pendingStatements.length > 0) {
    throw new PayrollSchemaGuardError(
      '薪酬数据库结构尚未完成显式迁移',
      'PAYROLL_SCHEMA_MIGRATION_REQUIRED',
      { pendingStatementCount: pendingStatements.length }
    );
  }

  return true;
}

module.exports = {
  PayrollSchemaGuardError,
  assertPayrollSchemaReady
};
