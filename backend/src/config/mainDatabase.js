const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const mainSequelize = new Sequelize(
  process.env.MAIN_DB_NAME || 'patent_notice_system',
  process.env.MAIN_DB_USER || 'root',
  process.env.MAIN_DB_PASSWORD || '',
  {
    host: process.env.MAIN_DB_HOST || 'localhost',
    port: parseInt(process.env.MAIN_DB_PORT, 10) || 3306,
    dialect: 'mysql',
    timezone: '+08:00',
    pool: {
      max: 10,
      min: 2,
      acquire: 30000,
      idle: 10000
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    define: {
      timestamps: true,
      underscored: true
    }
  }
);

const connectMainDatabase = async ({ database = mainSequelize } = {}) => {
  try {
    await database.authenticate();
    logger.info('主项目数据库连接成功（只读）');
    return true;
  } catch (error) {
    throw new AppError(
      'legacy 会话依赖的主项目数据库无法连接',
      503,
      'LEGACY_MAIN_DATABASE_UNAVAILABLE'
    );
  }
};

module.exports = { mainSequelize, connectMainDatabase };
