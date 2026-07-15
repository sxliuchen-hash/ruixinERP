const winston = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

const SENSITIVE_KEY_PATTERN = /(password|secret|authorization|assertion|token|cookie|idempotency.?key|authorization.?code|sso.?state)/i;

function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(
      /((?:password|secret|token|assertion|authorizationCode|idempotency-key|ssoState)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]'
    );
}

function redactSensitive(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const normalizedKey = key.replace(/[_-]/g, '');
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey) && !/present$/i.test(normalizedKey)) {
      value[key] = '[REDACTED]';
    } else {
      value[key] = redactSensitive(value[key], seen);
    }
  }
  return value;
}

const redactFormat = winston.format((info) => redactSensitive(info));

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    redactFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'erp-backend' },
  transports: [
    // 所有日志写入 app.log
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),
    // 错误日志单独写入 error.log
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// 非生产环境同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

module.exports = logger;
module.exports.redactString = redactString;
module.exports.redactSensitive = redactSensitive;
