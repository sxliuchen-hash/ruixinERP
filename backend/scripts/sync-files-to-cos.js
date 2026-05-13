/**
 * ============================================================
 * 批量同步审批附件到 COS
 * ============================================================
 * 用法：node scripts/sync-files-to-cos.js [limit]
 * 示例：node scripts/sync-files-to-cos.js 100
 *
 * 遍历所有已同步的合同（有 sp_no 的），拉取审批详情中的附件，
 * 下载后上传到 COS，将 URL 存入合同的 attachment_url 字段（JSON 数组）。
 *
 * 【断点续跑】
 *   已有 attachment_url 的记录会跳过，可以安全重复执行。
 *
 * 【频率控制】
 *   每个文件间隔 500ms，每个审批单间隔 1s，避免触发企微限流。
 * ============================================================
 */
require('dotenv').config();
const { Contract, Payment } = require('../src/models');
const { Op } = require('sequelize');
const wechatApiService = require('../src/services/wechat/wechatApiService');
const wechatFileService = require('../src/services/wechat/wechatFileService');

const LIMIT = parseInt(process.argv[2]) || 9999;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncContractFiles() {
  // 找出有 sp_no 且没有 attachment_url 的合同
  const contracts = await Contract.findAll({
    where: {
      sp_no: { [Op.ne]: null },
      [Op.or]: [
        { attachment_url: null },
        { attachment_url: '' }
      ]
    },
    attributes: ['id', 'sp_no'],
    limit: LIMIT,
    order: [['id', 'DESC']]
  });

  console.log(`找到 ${contracts.length} 条合同需要同步附件`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const contract of contracts) {
    try {
      const token = await wechatApiService.getAccessToken();
      const res = await fetch('https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovaldetail?access_token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sp_no: contract.sp_no })
      });
      const data = await res.json();

      if (data.errcode !== 0 || !data.info) {
        skipped++;
        continue;
      }

      const results = await wechatFileService.syncApprovalFiles(
        contract.sp_no,
        'contracts',
        data.info.apply_data
      );

      const successFiles = results.filter(r => r.url);
      if (successFiles.length > 0) {
        // 存为 JSON 数组
        const attachments = JSON.stringify(successFiles.map(f => ({
          field: f.field,
          url: f.url,
          size: f.size
        })));
        await contract.update({ attachment_url: attachments });
        synced++;
        if (synced % 10 === 0) {
          console.log(`  进度: ${synced} 条已同步附件`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`  ✗ ${contract.sp_no}: ${e.message}`);
    }

    await sleep(1000);
  }

  return { synced, skipped, failed };
}

async function syncPaymentFiles() {
  // 付款记录也可能有附件（付款回执、付款截图）
  const payments = await Payment.findAll({
    where: {
      sp_no: { [Op.ne]: null },
      [Op.or]: [
        { remark: { [Op.notLike]: '%cos.myqcloud%' } },
        { remark: null }
      ]
    },
    attributes: ['id', 'sp_no', 'remark'],
    limit: LIMIT,
    order: [['id', 'DESC']]
  });

  console.log(`找到 ${payments.length} 条付款需要同步附件`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const payment of payments) {
    try {
      const token = await wechatApiService.getAccessToken();
      const res = await fetch('https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovaldetail?access_token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sp_no: payment.sp_no })
      });
      const data = await res.json();

      if (data.errcode !== 0 || !data.info) {
        skipped++;
        continue;
      }

      const results = await wechatFileService.syncApprovalFiles(
        payment.sp_no,
        'payments',
        data.info.apply_data
      );

      const successFiles = results.filter(r => r.url);
      if (successFiles.length > 0) {
        // 付款记录没有专门的附件字段，追加到 remark
        const fileInfo = successFiles.map(f => `${f.field}: ${f.url}`).join('\n');
        const newRemark = (payment.remark || '') + '\n附件:\n' + fileInfo;
        await payment.update({ remark: newRemark.slice(0, 5000) });
        synced++;
        if (synced % 10 === 0) {
          console.log(`  进度: ${synced} 条已同步附件`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`  ✗ ${payment.sp_no}: ${e.message}`);
    }

    await sleep(1000);
  }

  return { synced, skipped, failed };
}

async function main() {
  console.log('===== 批量同步审批附件到 COS =====\n');

  console.log('--- 合同附件 ---');
  const contractResult = await syncContractFiles();
  console.log(`合同: 同步=${contractResult.synced} 跳过=${contractResult.skipped} 失败=${contractResult.failed}\n`);

  console.log('--- 付款附件 ---');
  const paymentResult = await syncPaymentFiles();
  console.log(`付款: 同步=${paymentResult.synced} 跳过=${paymentResult.skipped} 失败=${paymentResult.failed}\n`);

  console.log('===== 完成 =====');
  process.exit(0);
}

main().catch(e => {
  console.error('脚本异常:', e.message);
  process.exit(1);
});
