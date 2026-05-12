const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

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

const connectMainDatabase = async () => {
  try {
    await mainSequelize.authenticate();
    logger.info('主项目数据库连接成功（只读）');
  } catch (error) {
    logger.error('主项目数据库连接失败:', error);
    // 主项目数据库连接失败不阻止 ERP 启动，但记录错误
    logger.warn('ERP 将在无主项目数据库连接的情况下运行');
  }
};

module.exports = { mainSequelize, connectMainDatabase };
