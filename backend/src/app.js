require('dotenv').config();

// 设置进程时区为北京时间
process.env.TZ = 'Asia/Shanghai';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { connectMainDatabase } = require('./config/mainDatabase');
const errorHandler = require('./middlewares/errorHandler');
const { NotFoundError } = require('./utils/errors');
const routes = require('./routes');
const { initJobs } = require('./jobs');

const app = express();

// ==================== 中间件 ====================

// 信任反向代理（Nginx），使 express-rate-limit 等中间件能正确获取客户端 IP
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// 安全头
app.use(helmet());

// 压缩
app.use(compression());

// 请求体解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 1000, // 每个 IP 最多 1000 次请求
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: '请求过于频繁，请稍后再试'
  }
});
app.use('/api/', limiter);

// 合同/审批附件统一通过鉴权的 /api/v1/files 代理下载，
// 不再以 express.static 公开 uploads 目录，避免未授权直接访问敏感附件

// ==================== 路由 ====================

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    message: 'ERP Backend is running',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// 业务路由（统一注册）
app.use('/api/v1', routes);

// 404 处理
app.use((req, res, next) => {
  next(new NotFoundError(`接口不存在: ${req.method} ${req.originalUrl}`));
});

// 全局错误处理
app.use(errorHandler);

// ==================== 启动服务 ====================

const PORT = process.env.PORT || 3001;

const start = async () => {
  try {
    // 连接数据库
    await connectDatabase();
    await connectMainDatabase();

    // 初始化定时任务
    initJobs();

    app.listen(PORT, () => {
      logger.info(`ERP Backend 启动成功，端口: ${PORT}`);
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('服务启动失败:', error);
    process.exit(1);
  }
};

start();

module.exports = app;
