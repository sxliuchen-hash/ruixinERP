/**
 * 定时任务注册中心
 * 使用 node-cron 管理所有定时任务
 */
const cron = require('node-cron');
const logger = require('../utils/logger');

/**
 * 初始化所有定时任务
 */
const initJobs = () => {
  logger.info('定时任务初始化...');

  // TODO: Phase 2 - 企业微信审批同步（每小时）
  cron.schedule('0 * * * *', () => {
    require('./wechatSyncJob').run().catch(e => {
      logger.error('wechatSyncJob 执行失败:', e);
    });
  });
  logger.info('已注册：企微审批同步（每小时整点）');

  // Phase 3 T15 - 专利年费到期提醒（每日 09:00）
  cron.schedule('0 9 * * *', () => {
    require('./feeReminderJob').run().catch(e => {
      logger.error('feeReminderJob 执行失败:', e);
    });
  });
  logger.info('已注册：专利年费到期提醒（每日 09:00）');

  // Phase 3 T15 - 合同到期提醒（每日 09:00）
  cron.schedule('0 9 * * *', () => {
    require('./contractReminderJob').run().catch(e => {
      logger.error('contractReminderJob 执行失败:', e);
    });
  });
  logger.info('已注册：合同到期提醒（每日 09:00）');

  // Phase 3 T17 - 固定月费自动生成（每月1日 0:05，避开整点，规避与其他任务冲突）
  cron.schedule('5 0 1 * *', () => {
    require('./recurringCostJob').run().catch(e => {
      logger.error('recurringCostJob 执行失败:', e);
    });
  });
  logger.info('已注册：固定月费自动生成（每月 1 日 00:05）');

  logger.info('定时任务初始化完成');
};

module.exports = { initJobs };
