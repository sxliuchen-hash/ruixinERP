/**
 * ============================================================
 * 在库专利全量信息批量查询定时任务
 * ============================================================
 *
 * 【触发时间】每周日 06:00 / 管理员手动触发
 *
 * 【进度追踪】
 *   通过 Redis 存储实时进度，前端轮询 /api/v1/inventory/anomalies/scan-progress 获取
 *   Redis key: erp:patent_scan_progress
 *   结构: { status, total, scanned, failed, alerts, logs[], startedAt, finishedAt }
 * ============================================================
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');
const redis = require('../config/redis');
const PatentInventory = require('../models/PatentInventory');
const patentAnomalyService = require('../services/patentAnomalyService');
const logger = require('../utils/logger');

const REQUEST_INTERVAL_MS = 3000;
const FAILURE_PAUSE_MS = 60000;
const BATCH_PAUSE_SIZE = 20;
const BATCH_PAUSE_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 3;
const IP_API_BASE = process.env.IP_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const PROGRESS_KEY = 'patent_scan_progress';
const PROGRESS_TTL = 3600; // 1 小时后自动过期
const STOP_KEY = 'patent_scan_stop';

// 内存备份（Redis 不可用时使用）
let memoryProgress = null;
let memoryStop = false;

/**
 * 生成系统 Token（ERP 与 IP 系统共用 JWT_SECRET 和 users 表）
 * 自签的 Token 在 IP 系统同样有效
 */
function generateSystemToken() {
  return jwt.sign(
    { id: parseInt(process.env.IP_SYSTEM_USER_ID, 10) || 1, username: 'system', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function fetchIpPatentDetail(patentNo, token) {
  // 使用代查接口（POST），支持查询任意专利号
  const response = await axios.post(
    `${IP_API_BASE}/patent-query/detail`,
    { patentNo },
    {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 45000, // 首次查询国知局需要 15-30 秒
      validateStatus: (status) => status < 500
    }
  );
  if (response.data?.code === 200) {
    return response.data.data;
  }
  if (response.status === 404 || response.data?.code === 404) {
    return null; // 国知局查不到该专利
  }
  if (response.status === 503 || response.data?.code === 503) {
    throw new Error('国知局查询服务暂时不可用');
  }
  throw new Error(response.data?.message || `IP 系统返回 ${response.status}`);
}

/**
 * 调用 IP 系统获取专利基本信息（按专利号查 patents 表）
 * 注意：此接口只能查 IP 系统已录入的专利，查不到返回 null
 */
async function fetchIpPatentInfo(patentNo, token) {
  const response = await axios.get(
    `${IP_API_BASE}/patents/no/${encodeURIComponent(patentNo)}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 15000,
      validateStatus: (status) => status < 500
    }
  );
  if (response.data?.code === 200) {
    return response.data.data;
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 更新进度到 Redis（带内存备份）
 */
async function updateProgress(data) {
  memoryProgress = data;
  try {
    await redis.set(PROGRESS_KEY, JSON.stringify(data), 'EX', PROGRESS_TTL);
  } catch (e) {
    // Redis 不可用时使用内存备份
  }
}

/**
 * 检查是否收到停止信号
 */
async function shouldStop() {
  try {
    const val = await redis.get(STOP_KEY);
    return val === '1';
  } catch (e) {
    return memoryStop;
  }
}

/**
 * 发送停止信号
 */
async function requestStop() {
  memoryStop = true;
  try {
    await redis.set(STOP_KEY, '1', 'EX', 300);
  } catch (e) {
    // 内存备份已设置
  }
}

/**
 * 清除停止信号
 */
async function clearStop() {
  memoryStop = false;
  try {
    await redis.del(STOP_KEY);
  } catch (e) {
    // 静默
  }
}

/**
 * 追加日志到进度
 */
async function appendLog(progress, message, level = 'info') {
  const logEntry = {
    time: new Date().toLocaleTimeString('zh-CN'),
    level,
    message
  };
  progress.logs.push(logEntry);
  // 只保留最近 200 条日志
  if (progress.logs.length > 200) {
    progress.logs = progress.logs.slice(-200);
  }
  await updateProgress(progress);
}

/**
 * 获取当前进度
 */
async function getProgress() {
  try {
    const data = await redis.get(PROGRESS_KEY);
    if (data) return JSON.parse(data);
  } catch (e) {
    // Redis 不可用
  }
  return memoryProgress;
}

/**
 * 执行批量扫描
 */
async function run() {
  const startTs = Date.now();
  logger.info('[PatentBatchQueryJob] 开始扫描在库专利全量信息');

  // 初始化进度
  const progress = {
    status: 'running',
    total: 0,
    scanned: 0,
    failed: 0,
    alerts: 0,
    synced: 0,
    logs: [],
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  // 1. 拉取在库专利
  const inventories = await PatentInventory.findAll({
    where: { status: 'in_stock' },
    attributes: ['id', 'patent_no', 'patent_name', 'patent_type', 'next_fee_deadline']
  });

  if (inventories.length === 0) {
    progress.status = 'completed';
    progress.finishedAt = new Date().toISOString();
    await appendLog(progress, '无在库专利，扫描结束');
    logger.info('[PatentBatchQueryJob] 无在库专利，跳过');
    return { scanned: 0, alerts: 0, failed: 0 };
  }

  progress.total = inventories.length;
  await appendLog(progress, `开始扫描，共 ${inventories.length} 条在库专利`);

  // 清除之前的停止信号
  await clearStop();

  // 2. 生成系统 Token（共用 JWT_SECRET，自签即可）
  const token = generateSystemToken();
  await appendLog(progress, '认证 Token 已生成');

  let consecutiveFailures = 0;

  for (let i = 0; i < inventories.length; i++) {
    const inv = inventories[i];

    // 检查停止信号
    if (await shouldStop()) {
      progress.status = 'stopped';
      progress.finishedAt = new Date().toISOString();
      await appendLog(progress, `⏹ 用户手动停止，已完成 ${progress.scanned} 条`, 'warning');
      logger.info('[PatentBatchQueryJob] 用户手动停止');
      return { scanned: progress.scanned, alerts: progress.alerts, failed: progress.failed, stopped: true };
    }

    // 每 BATCH_PAUSE_SIZE 条暂停一次
    if (i > 0 && i % BATCH_PAUSE_SIZE === 0) {
      await appendLog(progress, `已处理 ${i} 条，暂停 ${BATCH_PAUSE_MS / 1000} 秒避免风控...`, 'info');
      await sleep(BATCH_PAUSE_MS);
    }

    try {
      // 1) 调用年费详情接口（含应缴/已缴/发文/质押/许可/变更）
      const ipFeeData = await fetchIpPatentDetail(inv.patent_no, token);

      if (!ipFeeData) {
        // 国知局查不到该专利号
        progress.scanned++;
        await appendLog(progress, `[${i + 1}/${inventories.length}] ${inv.patent_no} - 国知局未收录，跳过`, 'info');
        consecutiveFailures = 0;
        await sleep(REQUEST_INTERVAL_MS);
        continue;
      }

      // 间隔后调用第二个接口
      await sleep(REQUEST_INTERVAL_MS);

      // 2) 调用专利基本信息接口（含发明人/代理/IPC/授权等）
      let ipPatentInfo = null;
      try {
        ipPatentInfo = await fetchIpPatentInfo(inv.patent_no, token);
      } catch (e2) {
        // 第二个接口失败不影响整体
        logger.warn(`[PatentBatchQueryJob] ${inv.patent_no} 基本信息获取失败: ${e2.message}`);
      }

      // 合并两个接口的数据用于异常检测
      const mergedData = { ...ipFeeData };
      if (ipPatentInfo) {
        // 补充 detail 信息（发明人/代理/IPC 等）
        if (ipPatentInfo.detail && !mergedData.detail) {
          mergedData.detail = ipPatentInfo.detail;
        }
        // 补充官文数量等
        if (ipPatentInfo.noticeCount !== undefined) {
          mergedData.noticeCount = ipPatentInfo.noticeCount;
        }
      }

      // 异常检测
      const newAlerts = await patentAnomalyService.detectAndRecord(inv, mergedData);
      progress.alerts += newAlerts.length;

      // 同步基础信息到本地
      const updates = {};
      if (mergedData.patent?.patentName && (!inv.patent_name || inv.patent_name === inv.patent_no)) {
        updates.patent_name = mergedData.patent.patentName;
      }
      if (mergedData.patent?.patentType && !inv.patent_type) {
        updates.patent_type = mergedData.patent.patentType;
      }
      if (mergedData.patent?.nextFeeDeadline && mergedData.patent.nextFeeDeadline !== inv.next_fee_deadline) {
        updates.next_fee_deadline = mergedData.patent.nextFeeDeadline;
      }
      if (Object.keys(updates).length > 0) {
        await PatentInventory.update(updates, { where: { id: inv.id } });
        progress.synced++;
      }

      progress.scanned++;
      consecutiveFailures = 0;

      // 日志
      const logMsg = newAlerts.length > 0
        ? `[${i + 1}/${inventories.length}] ${inv.patent_no} ⚠ 发现 ${newAlerts.length} 个异常`
        : `[${i + 1}/${inventories.length}] ${inv.patent_no} ✓`;
      await appendLog(progress, logMsg, newAlerts.length > 0 ? 'warning' : 'info');

    } catch (e) {
      progress.failed++;
      consecutiveFailures++;

      await appendLog(progress, `[${i + 1}/${inventories.length}] ${inv.patent_no} ✗ ${e.message}`, 'error');
      logger.warn(`[PatentBatchQueryJob] ${inv.patent_no} 查询失败: ${e.message}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await appendLog(progress, `连续失败 ${consecutiveFailures} 次，暂停 60 秒...`, 'warning');
        await sleep(FAILURE_PAUSE_MS);
        consecutiveFailures = 0;
      }
    }

    // 限流
    await sleep(REQUEST_INTERVAL_MS);
  }

  // 完成
  const cost = Date.now() - startTs;
  progress.status = 'completed';
  progress.finishedAt = new Date().toISOString();
  await appendLog(progress, `扫描完成！成功 ${progress.scanned} 条，失败 ${progress.failed} 条，发现异常 ${progress.alerts} 个，同步信息 ${progress.synced} 条，耗时 ${Math.round(cost / 1000)} 秒`);

  logger.info('[PatentBatchQueryJob] 扫描完成', {
    scanned: progress.scanned,
    alerts: progress.alerts,
    failed: progress.failed,
    synced: progress.synced,
    cost_ms: cost
  });

  return { scanned: progress.scanned, alerts: progress.alerts, failed: progress.failed, cost_ms: cost };
}

module.exports = { run, getProgress, requestStop };
