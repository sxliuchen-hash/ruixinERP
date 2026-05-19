/**
 * ============================================================
 * 在库专利全量信息批量查询定时任务
 * ============================================================
 *
 * 【触发时间】每周日 06:00（避开工作时间）
 *
 * 【业务流程】
 *   1) 查询所有 status='in_stock' 的专利
 *   2) 逐个调用 IP 系统 patent-fee/detail 接口
 *   3) 调用异常检测服务，发现异常即写入 patent_anomaly_alerts 表
 *   4) 同步基础信息（patent_name/type/next_fee_deadline）到本地
 *
 * 【认证策略】
 *   定时任务无 HTTP 上下文，无法直接复用用户 JWT。
 *   方案：使用专用的"系统 Token"——在数据库中预设一个 admin 账号，
 *   定时任务启动时通过 jwt.sign 直接签发短期 Token 调用 IP 系统。
 *
 * 【限流】
 *   每次请求间隔 800ms，避免触发 IP 系统频率限制
 *
 * 【容错】
 *   单个专利失败不阻断整体；记录失败次数，连续失败 > 3 个则暂停 60s
 * ============================================================
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');
const PatentInventory = require('../models/PatentInventory');
const patentAnomalyService = require('../services/patentAnomalyService');
const logger = require('../utils/logger');

const REQUEST_INTERVAL_MS = 800;
const FAILURE_PAUSE_MS = 60000;
const MAX_CONSECUTIVE_FAILURES = 3;
const IP_API_BASE = process.env.IP_API_BASE_URL || 'https://iptt.top/api/v1';

/**
 * 生成系统级 Token（用于定时任务调用 IP 系统）
 *
 * 由于 ERP 与 IP 系统共用 JWT_SECRET，使用一个虚构的 admin payload 即可。
 * 实际生产建议在主项目数据库中预设一个 system 角色账号。
 */
function generateSystemToken() {
  // 使用环境变量中的系统账号，或退回到默认 admin
  const systemUser = {
    id: parseInt(process.env.IP_SYSTEM_USER_ID, 10) || 1,
    username: process.env.IP_SYSTEM_USERNAME || 'system',
    role: 'admin'
  };

  return jwt.sign(systemUser, process.env.JWT_SECRET, { expiresIn: '2h' });
}

/**
 * 调用 IP 系统获取单个专利详情
 */
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
 * 执行批量扫描
 */
async function run() {
  const startTs = Date.now();
  logger.info('[PatentBatchQueryJob] 开始扫描在库专利全量信息');

  // 1. 拉取在库专利
  const inventories = await PatentInventory.findAll({
    where: { status: 'in_stock' },
    attributes: ['id', 'patent_no', 'patent_name', 'patent_type', 'next_fee_deadline']
  });

  if (inventories.length === 0) {
    logger.info('[PatentBatchQueryJob] 无在库专利，跳过');
    return { scanned: 0, alerts: 0, failed: 0 };
  }

  logger.info(`[PatentBatchQueryJob] 待扫描专利数：${inventories.length}`);

  // 2. 生成系统 Token
  const token = generateSystemToken();

  let scanned = 0;
  let alertsTotal = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (const inv of inventories) {
    try {
      // 拉取 IP 系统数据
      const ipData = await fetchIpPatentDetail(inv.patent_no, token);

      // 异常检测
      const newAlerts = await patentAnomalyService.detectAndRecord(inv, ipData);
      alertsTotal += newAlerts.length;

      // 同步基础信息（仅在本地为空时更新）
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
      }

      scanned++;
      consecutiveFailures = 0;

      if (newAlerts.length > 0) {
        logger.warn(`[PatentBatchQueryJob] ${inv.patent_no} 发现 ${newAlerts.length} 个异常`);
      }
    } catch (e) {
      failed++;
      consecutiveFailures++;
      logger.warn(`[PatentBatchQueryJob] ${inv.patent_no} 查询失败: ${e.message}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.warn(`[PatentBatchQueryJob] 连续失败 ${consecutiveFailures} 次，暂停 ${FAILURE_PAUSE_MS}ms`);
        await sleep(FAILURE_PAUSE_MS);
        consecutiveFailures = 0;
      }
    }

    // 限流
    await sleep(REQUEST_INTERVAL_MS);
  }

  const cost = Date.now() - startTs;
  logger.info('[PatentBatchQueryJob] 扫描完成', {
    scanned,
    alerts: alertsTotal,
    failed,
    cost_ms: cost
  });

  return { scanned, alerts: alertsTotal, failed, cost_ms: cost };
}

module.exports = { run };
