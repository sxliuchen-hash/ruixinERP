/**
 * 操作日志中间件
 * 异步记录数据变更操作，不阻塞响应
 * 
 * 记录字段：user_id, action, target_table, target_id, before_data, after_data, ip_address
 * 仅应用于修改数据的路由（POST, PUT, DELETE）
 */

const logger = require('../utils/logger');

// JSON 数据最大存储大小（字符数），超出则截断
const MAX_DATA_SIZE = 10000;

/**
 * 安全地序列化数据，限制大小
 * @param {*} data - 要序列化的数据
 * @returns {string|null} JSON 字符串或 null
 */
function safeStringify(data) {
  if (data == null) return null;
  try {
    const str = JSON.stringify(data);
    if (str.length > MAX_DATA_SIZE) {
      return JSON.stringify({ _truncated: true, _message: '数据过大已截断', _size: str.length });
    }
    return str;
  } catch (error) {
    return JSON.stringify({ _error: '序列化失败', _message: error.message });
  }
}

/**
 * 获取客户端真实 IP 地址（支持代理）
 * @param {object} req - Express request
 * @returns {string} IP 地址
 */
function getClientIp(req) {
  // 优先从 x-forwarded-for 获取（Nginx 代理场景）
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for 可能包含多个 IP，取第一个（客户端真实 IP）
    return forwarded.split(',')[0].trim();
  }
  // 其次从 x-real-ip 获取
  if (req.headers['x-real-ip']) {
    return req.headers['x-real-ip'];
  }
  // 最后从连接获取
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

/**
 * 异步写入操作日志到数据库
 * 使用 setImmediate 确保不阻塞响应
 * @param {object} logEntry - 日志条目
 */
function writeLogAsync(logEntry) {
  setImmediate(async () => {
    try {
      const { sequelize } = require('../config/database');

      await sequelize.query(
        `INSERT INTO operation_logs (user_id, action, target_table, target_id, before_data, after_data, ip_address, create_time) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        {
          replacements: [
            logEntry.user_id,
            logEntry.action,
            logEntry.target_table,
            logEntry.target_id,
            safeStringify(logEntry.before_data),
            safeStringify(logEntry.after_data),
            logEntry.ip_address
          ]
        }
      );
    } catch (error) {
      // 日志记录失败不影响业务，仅打印错误
      logger.error('操作日志写入失败:', {
        error: error.message,
        logEntry: {
          user_id: logEntry.user_id,
          action: logEntry.action,
          target_table: logEntry.target_table,
          target_id: logEntry.target_id
        }
      });
    }
  });
}

/**
 * 操作日志中间件（核心）
 * 拦截 res.json 响应，在响应发送后异步记录操作日志
 * 
 * @param {string} action - 操作类型: 'create' | 'update' | 'delete'
 * @param {string} targetTable - 目标表名
 * @param {object} [options] - 可选配置
 * @param {function} [options.getTargetId] - 从响应数据和请求中提取目标ID: (responseData, req) => id
 * @param {function} [options.getAfterData] - 自定义提取变更后数据: (responseData, req) => object
 * @param {function} [options.getBeforeData] - 自定义提取变更前数据: (req) => object（同步）
 * @param {boolean} [options.logRequestBody] - 是否将请求体作为 after_data（默认 false）
 * @returns {function} Express 中间件
 * 
 * @example
 * // 创建操作 - 从响应中提取新记录ID
 * router.post('/', operationLog('create', 'contracts', {
 *   getTargetId: (data) => data.data && data.data.id
 * }), controller.create);
 * 
 * // 更新操作 - 使用 URL 参数中的 ID
 * router.put('/:id', operationLog('update', 'contracts'), controller.update);
 * 
 * // 删除操作
 * router.delete('/:id', operationLog('delete', 'contracts'), controller.delete);
 */
const operationLog = (action, targetTable, options = {}) => {
  return (req, res, next) => {
    // 保存原始 json 方法引用
    const originalJson = res.json.bind(res);
    let logged = false; // 防止重复记录

    res.json = function (data) {
      // 先发送响应，确保不阻塞
      originalJson(data);

      // 防止重复记录（某些场景 res.json 可能被调用多次）
      if (logged) return;
      logged = true;

      // 仅记录成功的操作（状态码 < 400）
      if (res.statusCode >= 400) return;

      // 必须有已认证用户
      if (!req.user || !req.user.id) return;

      // 构建日志条目
      const logEntry = {
        user_id: req.user.id,
        action,
        target_table: targetTable,
        target_id: extractTargetId(data, req, options),
        before_data: req._beforeData || null,
        after_data: extractAfterData(data, req, action, options),
        ip_address: getClientIp(req)
      };

      // 异步写入
      writeLogAsync(logEntry);
    };

    next();
  };
};

/**
 * 提取目标记录 ID
 */
function extractTargetId(responseData, req, options) {
  // 优先使用自定义提取函数
  if (options.getTargetId) {
    try {
      return options.getTargetId(responseData, req) || null;
    } catch (e) {
      return null;
    }
  }
  // 默认：URL 参数中的 id
  if (req.params.id) {
    return parseInt(req.params.id, 10) || req.params.id;
  }
  // 创建操作：尝试从响应数据中提取
  if (responseData && responseData.data && responseData.data.id) {
    return responseData.data.id;
  }
  return null;
}

/**
 * 提取变更后数据
 */
function extractAfterData(responseData, req, action, options) {
  // 删除操作不记录 after_data
  if (action === 'delete') return null;

  // 自定义提取
  if (options.getAfterData) {
    try {
      return options.getAfterData(responseData, req);
    } catch (e) {
      return null;
    }
  }

  // 如果配置了记录请求体
  if (options.logRequestBody && req.body) {
    return req.body;
  }

  // 默认：从响应中提取 data 字段
  if (responseData && responseData.data) {
    return responseData.data;
  }

  return null;
}

/**
 * 捕获变更前数据的中间件
 * 用于 update/delete 操作，在执行前先查询原始数据
 * 
 * @param {function} queryFn - 查询原始数据的异步函数: (req) => Promise<object>
 * @returns {function} Express 中间件
 * 
 * @example
 * // 更新合同前捕获原始数据
 * router.put('/:id',
 *   captureBeforeData(async (req) => {
 *     const contract = await Contract.findByPk(req.params.id);
 *     return contract ? contract.toJSON() : null;
 *   }),
 *   operationLog('update', 'contracts'),
 *   controller.update
 * );
 */
const captureBeforeData = (queryFn) => {
  return async (req, res, next) => {
    try {
      if (typeof queryFn === 'function') {
        const data = await queryFn(req);
        // 存储到 req 对象上，供 operationLog 中间件使用
        req._beforeData = data || null;
      }
    } catch (error) {
      // 捕获失败不阻塞请求
      logger.warn('捕获变更前数据失败:', {
        error: error.message,
        url: req.originalUrl
      });
      req._beforeData = null;
    }
    next();
  };
};

/**
 * 便捷方法：为路由器批量应用操作日志
 * 根据 HTTP 方法自动判断 action 类型
 * 
 * @param {string} targetTable - 目标表名
 * @param {object} [options] - 传递给 operationLog 的选项
 * @returns {function} Express 中间件
 * 
 * @example
 * // 自动根据 HTTP 方法判断操作类型
 * router.post('/', autoLog('contracts'), controller.create);
 * router.put('/:id', autoLog('contracts'), controller.update);
 * router.delete('/:id', autoLog('contracts'), controller.delete);
 */
const autoLog = (targetTable, options = {}) => {
  return (req, res, next) => {
    const methodActionMap = {
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete'
    };

    const action = methodActionMap[req.method];

    // 仅对修改数据的方法记录日志
    if (!action) {
      return next();
    }

    // 委托给 operationLog 中间件
    return operationLog(action, targetTable, options)(req, res, next);
  };
};

module.exports = { operationLog, captureBeforeData, autoLog };
