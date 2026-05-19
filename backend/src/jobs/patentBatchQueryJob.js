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

const REQUEST_INTERVAL_MS = 800;
const FAILURE_PAUSE_MS = 60000;
const MAX_CONSECUTIVE_FAILURES = 3;
const IP_API_BASE = process.env.IP_API_BASE_URL || 'https://iptt.top/api/v1';
const PROGRESS_KEY = 'patent_scan_progress';
const PROGRESS_TTL = 3600; // 1 小时后自动过期

// 内存备份（Redis 不可用时使用）
let memoryProgress = null;

function generateSystemToken() {
  const systemUser = {
    id: parseInt(process.env.IP_SYSTEM_USER_ID, 10) || 1,
    username: process.env.IP_SYSTEM_USERNAME || 'system',
    role: 'admin'
  };
  return jwt.sign(systemUser, process.env.JWT_SECRET, { expiresIn: '2h' });
}

async function fetchIpPatentDetail(patentNo, token) {
  const response = await axios.get(
    `${IP_API_BASE}/patent-fee/detail/${encodeURIComponent(patentNo)}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 15000
    }
  );
  if (response.data?.code === 200) {
    return response.data.data;
  }
  throw new Error(response.data?.message || 'IP 系统返回非 200');
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

  // 2. 生成系统 Token
  const token = generateSystemToken();

  let consecutiveFailures = 0;

  for (let i = 0; i < inventories.length; i++) {
    const inv = inventories[i];

    try {
      // 拉取 IP 系统数据
      const ipData = await fetchIpPatentDetail(inv.patent_no, token);

      // 异常检测
      const newAlerts = await patentAnomalyService.detectAndRecord(inv, ipData);
      progress.alerts += newAlerts.length;

      // 同步基础信息
      const updates = {};
      if (ipData.patent?.patentName && (!inv.patent_name || inv.patent_name === inv.patent_no)) {
        updates.patent_name = ipData.patent.patentName;
      }
      if (ipData.patent?.patentType && !inv.patent_type) {
        updates.patent_type = ipData.patent.patentType;
      }
      if (ipData.patent?.nextFeeDeadline && ipData.patent.nextFeeDeadline !== inv.next_fee_deadline) {
        updates.next_fee_deadline = ipData.patent.nextFeeDeadline;
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

module.exports = { run, getProgress };
