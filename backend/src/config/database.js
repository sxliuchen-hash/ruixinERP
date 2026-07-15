const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const { assertEmployeeUserIdUniqueIndex } = require('../services/employeeIndexGuard');
const { assertWechatSpNoUniqueIndexes } = require('../services/wechatSpNoIndexGuard');
const {
  assertPerformanceImportConfirmedPeriodUniqueIndex
} = require('../services/performanceImportIndexGuard');
const { assertPayrollSchemaReady } = require('../services/payrollSchemaGuard');

function createDatabaseConnection(env = process.env) {
  return new Sequelize(
    env.DB_NAME || 'erp_db',
    env.DB_USER || 'root',
    env.DB_PASSWORD || '',
    {
      host: env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT, 10) || 3306,
      dialect: 'mysql',
      timezone: '+08:00',
      pool: {
        max: 10,
        min: 2,
        acquire: 30000,
        idle: 10000
      },
      logging: env.NODE_ENV === 'development' ? console.log : false,
      define: {
        timestamps: true,
        underscored: true,
        createdAt: 'create_time',
        updatedAt: 'update_time'
      }
    }
  );
}

const sequelize = createDatabaseConnection();

const connectDatabase = async ({
  database = sequelize,
  employeeIndexCheck = assertEmployeeUserIdUniqueIndex,
  wechatIndexCheck = assertWechatSpNoUniqueIndexes,
  performanceIndexCheck = assertPerformanceImportConfirmedPeriodUniqueIndex,
  payrollSchemaCheck = assertPayrollSchemaReady
} = {}) => {
  try {
    await database.authenticate();
  } catch (error) {
    throw new AppError('ERP 数据库无法连接', 503, 'ERP_DATABASE_UNAVAILABLE');
  }

  try {
    await employeeIndexCheck(database);
    await wechatIndexCheck(database);
    await performanceIndexCheck(database);
    await payrollSchemaCheck(database);
  } catch (error) {
    throw new AppError('ERP 数据库结构未满足启动要求', 503, 'ERP_DATABASE_SCHEMA_INVALID');
  }

  logger.info('ERP 数据库连接成功');
  return true;
};

module.exports = { sequelize, createDatabaseConnection, connectDatabase };
