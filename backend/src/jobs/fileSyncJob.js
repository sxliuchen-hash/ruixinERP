/**
 * ============================================================
 * 附件自动同步定时任务
 * ============================================================
 * 每小时检查没有附件的合同，从企微下载附件上传到 COS。
 * 每次最多处理 30 条，避免长时间占用资源。
 * ============================================================
 */
const logger = require('../utils/logger');

async function run() {
  try {
    const { Contract } = require('../models');
    const { Op } = require('sequelize');
    const wechatApiService = require('../services/wechat/wechatApiService');
    const wechatFileService = require('../services/wechat/wechatFileService');

    // 找出有 sp_no 但没有附件的合同
    const contracts = await Contract.findAll({
      where: {
        sp_no: { [Op.ne]: null },
        [Op.or]: [
          { attachment_url: null },
          { attachment_url: '' }
        ]
      },
      attributes: ['id', 'sp_no'],
      limit: 30,
      order: [['id', 'DESC']]
    });

    if (contracts.length === 0) {
      logger.debug('[FileSyncJob] 无需同步的附件');
      return;
    }

    logger.info(`[FileSyncJob] 开始同步 ${contracts.length} 条合同附件`);
    let synced = 0;

    for (const contract of contracts) {
      try {
        const token = await wechatApiService.getAccessToken();
        const res = await fetch('https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovaldetail?access_token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sp_no: contract.sp_no })
        });
        const data = await res.json();

        if (data.errcode !== 0 || !data.info) continue;

        const results = await wechatFileService.syncApprovalFiles(
          contract.sp_no,
          'contracts',
          data.info.apply_data
        );

        const successFiles = results.filter(r => r.url);
        if (successFiles.length > 0) {
          const attachments = JSON.stringify(successFiles.map(f => ({
            field: f.field,
            url: f.url,
            size: f.size
          })));
          await contract.update({ attachment_url: attachments });
          synced++;
        }
      } catch (e) {
        logger.warn(`[FileSyncJob] ${contract.sp_no} 失败: ${e.message}`);
      }

      // 控制频率
      await new Promise(r => setTimeout(r, 1000));
    }

    logger.info(`[FileSyncJob] 完成: ${synced} 条附件已同步`);
  } catch (e) {
    logger.error('[FileSyncJob] 执行失败:', e.message);
  }
}

module.exports = { run };
