/**
 * ============================================================
 * 企微审批同步定时任务（兜底）
 * ============================================================
 * 每小时执行一次，拉取最近 2 小时的审批单进行同步。
 * 用于补漏回调丢失的情况（网络抖动、服务重启等）。
 *
 * 注册时机：jobs/index.js
 * Cron 表达式：0 * * * *（每小时整点）
 * ============================================================
 */

const logger = require('../utils/logger');

async function run() {
  try {
    const wechatConfig = require('../config/wechat');
    const { ok } = wechatConfig.isConfigured();
    if (!ok) {
      logger.debug('[WechatSyncJob] 企微未配置，跳过');
      return;
    }

    const wechatSyncService = require('../services/wechat/wechatSyncService');
    const result = await wechatSyncService.batchSync(2);
    logger.info('[WechatSyncJob] 定时同步完成', result);
  } catch (e) {
    logger.error('[WechatSyncJob] 定时同步失败', { error: e.message });
  }
}

module.exports = { run };
