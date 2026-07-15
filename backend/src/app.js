require('dotenv').config();

// 设置进程时区为北京时间
process.env.TZ = 'Asia/Shanghai';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { connectRequiredDatabases } = require('./config/startupDatabases');
const { connectRequiredRedis } = require('./config/startupRedis');
const { shutdownRuntime } = require('./config/runtimeResources');
const { assertProductionRuntimeConfig } = require('./services/unifiedAuthPreflightService');
const { checkReadiness } = require('./services/readinessService');
const errorHandler = require('./middlewares/errorHandler');
const { NotFoundError } = require('./utils/errors');
const routes = require('./routes');
const { initJobs, stopJobs } = require('./jobs');

const app = express();

// ==================== 中间件 ====================

// 信任反向代理（Nginx），使 express-rate-limit 等中间件能正确获取客户端 IP
app.set('trust proxy', 1);

// CORS：白名单机制，CORS_ORIGIN 支持逗号分隔多个来源；
// 未配置时仅放行本地开发端口，避免退化为 * 通配（与 credentials 冲突且不安全）
const corsWhitelist = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // 无 origin 的请求（同源、服务端调用、curl）放行
    if (!origin || corsWhitelist.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS 不允许的来源: ${origin}`));
  },
  credentials: true
}));

// 安全头：显式声明 Referrer-Policy=no-referrer，
// 避免 URL 中携带的 token（文件预览 / SSO 跳转场景）经 Referer 头泄漏到外部站点
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' }
}));

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
// 合同/审批附件统一通过鉴权的 /api/v1/files 代理下载，
// 不再以 express.static 公开 uploads 目录，避免未授权直接访问敏感附件

// ==================== 路由 ====================

function sendLiveness(req, res) {
  res.json({
    success: true,
    message: 'ERP Backend is running',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
}

// 兼容旧探针；live 只表示进程可响应，不代表依赖已经就绪。
app.get('/api/v1/health', sendLiveness);
app.get('/api/v1/health/live', sendLiveness);

// ready 仅检查本地运行配置、ERP 数据库和当前功能所需 Redis，
// 不在负载均衡探针中重复调用主项目远程接口。
app.get('/api/v1/health/ready', async (req, res) => {
  const readiness = await checkReadiness();
  res.status(readiness.ready ? 200 : 503).json({
    success: readiness.ready,
    code: readiness.ready ? 'READY' : 'NOT_READY',
    message: readiness.ready ? 'ERP Backend is ready' : 'ERP Backend is not ready',
    timestamp: new Date().toISOString(),
    data: readiness
  });
});

// Health probes must remain reliable even when business traffic is rate-limited.
app.use('/api/', limiter);

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
let activeServer = null;
let shuttingDown = false;

const start = async ({
  runtimeConfigCheck = assertProductionRuntimeConfig,
  connectDatabases = connectRequiredDatabases,
  connectRedis = connectRequiredRedis,
  startJobs = initJobs,
  listen = (port, callback) => app.listen(port, callback),
  shutdown = (options) => shutdownRuntime(options),
  exit = (code) => process.exit(code)
} = {}) => {
  try {
    // Fail before local dependencies, background jobs, or the listening socket.
    // This gate validates local configuration only; remote contract smoke stays in deployment.
    await runtimeConfigCheck();
    await connectDatabases();
    await connectRedis();

    // Start background jobs only after all startup gates pass.
    startJobs();

    activeServer = listen(PORT, () => {
      logger.info(`ERP Backend 启动成功，端口: ${PORT}`);
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
    });
    return activeServer;
  } catch (error) {
    logger.error('服务启动失败', {
      name: error?.name || 'Error',
      code: error?.code || 'STARTUP_ERROR'
    });
    await shutdown({ server: activeServer, stopJobs }).catch(() => undefined);
    exit(1);
    return null;
  }
};

async function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('收到退出信号，开始释放运行资源', { signal });
  try {
    await shutdownRuntime({ server: activeServer, stopJobs });
    logger.info('运行资源释放完成', { signal });
    logger.close();
    process.exit(0);
  } catch (error) {
    logger.error('运行资源释放失败', {
      signal,
      name: error?.name || 'Error',
      code: error?.code || 'SHUTDOWN_ERROR'
    });
    logger.close();
    process.exit(1);
  }
}

if (require.main === module) {
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  process.once('SIGINT', () => handleShutdown('SIGINT'));
  start();
}

module.exports = app;
module.exports.start = start;
module.exports.handleShutdown = handleShutdown;
