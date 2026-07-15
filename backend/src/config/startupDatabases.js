'use strict';

const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const { connectDatabase } = require('./database');
const { shouldConnectMainDatabase } = require('./authFeatures');

async function connectRequiredDatabases({
  connectErpDatabase = connectDatabase,
  connectLegacyMainDatabase
} = {}) {
  try {
    await connectErpDatabase();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('ERP 数据库启动检查失败', 503, 'ERP_DATABASE_STARTUP_FAILED');
  }

  if (!shouldConnectMainDatabase()) {
    logger.info('legacy 会话已关闭，跳过主项目数据库连接');
    return { mainDatabaseRequired: false, mainDatabaseConnected: false };
  }

  const connector = connectLegacyMainDatabase ||
    require('./mainDatabase').connectMainDatabase;
  let mainDatabaseConnected;
  try {
    mainDatabaseConnected = await connector();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'legacy 会话依赖的主项目数据库启动检查失败',
      503,
      'LEGACY_MAIN_DATABASE_UNAVAILABLE'
    );
  }
  if (mainDatabaseConnected !== true) {
    throw new AppError(
      'legacy 会话依赖的主项目数据库未就绪',
      503,
      'LEGACY_MAIN_DATABASE_UNAVAILABLE'
    );
  }
  return { mainDatabaseRequired: true, mainDatabaseConnected };
}

module.exports = { connectRequiredDatabases };
