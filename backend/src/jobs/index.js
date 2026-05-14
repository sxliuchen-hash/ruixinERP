/**
 * ============================================================
 * 定时任务注册中心
 * ============================================================
 * 使用 node-cron 管理所有定时任务
 *
 * 任务清单：
 *   1. 企微审批同步（每 10 分钟）
 *   2. 附件自动同步到 COS（每小时 30 分）
 *   3. 专利年费到期提醒（每日 09:00）
 *   4. 合同到期提醒（每日 09:00）
 *   5. 固定月费自动生成（每月 1 日 00:05）
 * ============================================================
 */
const cron = require('node-cron');
const logger = require('../utils/logger');

const initJobs = () => {
  logger.info('定时任务初始化...');

  // 1. 企微审批同步（每 10 分钟）
  cron.schedule('*/10 * * * *', () => {
    require('./wechatSyncJob').run().catch(e => {
      logger.error('wechatSyncJob 执行失败:', e);
    });
  });
  logger.info('已注册：企微审批同步（每 10 分钟）');

  // 2. 附件自动同步到 COS（每小时 30 分）
  cron.schedule('30 * * * *', () => {
    require('./fileSyncJob').run().catch(e => {
      logger.error('fileSyncJob 执行失败:', e);
    });
  });
  logger.info('已注册：附件自动同步（每小时 30 分）');

  // 3. 专利年费到期提醒（每日 09:00）
  cron.schedule('0 9 * * *', () => {
    require('./feeReminderJob').run().catch(e => {
      logger.error('feeReminderJob 执行失败:', e);
    });
  });
  logger.info('已注册：专利年费到期提醒（每日 09:00）');

  // 4. 合同到期提醒（每日 09:00）
  cron.schedule('0 9 * * *', () => {
    require('./contractReminderJob').run().catch(e => {
      logger.error('contractReminderJob 执行失败:', e);
    });
  });
  logger.info('已注册：合同到期提醒（每日 09:00）');

  // 5. 固定月费自动生成（每月 1 日 00:05）
  cron.schedule('5 0 1 * *', () => {
    require('./recurringCostJob').run().catch(e => {
      logger.error('recurringCostJob 执行失败:', e);
    });
  });
  logger.info('已注册：固定月费自动生成（每月 1 日 00:05）');

  logger.info('定时任务初始化完成');
};

module.exports = { initJobs };
