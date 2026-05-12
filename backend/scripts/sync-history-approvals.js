/**
 * ============================================================
 * 历史审批批量导入脚本
 * ============================================================
 * 用法：node scripts/sync-history-approvals.js [起始年月] [结束年月]
 * 示例：node scripts/sync-history-approvals.js 2022-01 2026-05
 *
 * 按月分批拉取企微审批单，逐条同步到 ERP。
 * 支持断点续跑（sp_no 幂等，重复跳过）。
 *
 * 【注意】
 *   - 企微 API 限流 10次/秒，脚本内置 300ms 间隔
 *   - 每月最多拉 100 条（企微单次上限），超过的月份需要缩小时间窗口
 *   - 建议在服务器上用 nohup 后台运行
 * ============================================================
 */
require('dotenv').config();
const wechatApiService = require('../src/services/wechat/wechatApiService');
const wechatSyncService = require('../src/services/wechat/wechatSyncService');
const logger = require('../src/utils/logger');

// 从命令行参数获取时间范围
const startMonth = process.argv[2] || '2022-01';
const endMonth = process.argv[3] || new Date().toISOString().slice(0, 7);

/**
 * 生成月份列表：['2022-01', '2022-02', ..., '2026-05']
 */
function generateMonths(start, end) {
  const months = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);

  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/**
 * 获取月份的起止 Unix 时间戳
 */
function getMonthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59); // 月末
  return {
    starttime: Math.floor(start.getTime() / 1000),
    endtime: Math.floor(end.getTime() / 1000)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n===== 历史审批批量导入 =====`);
  console.log(`时间范围: ${startMonth} ~ ${endMonth}`);

  const months = generateMonths(startMonth, endMonth);
  console.log(`共 ${months.length} 个月需要处理\n`);

  let totalSynced = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalFetched = 0;

  for (const ym of months) {
    const { starttime, endtime } = getMonthRange(ym);

    try {
      // 拉取该月审批单号列表
      const data = await wechatApiService.getApprovalInfo({
        starttime,
        endtime,
        size: 100
      });

      const spList = data.sp_no_list || [];
      totalFetched += spList.length;

      if (spList.length === 0) {
        console.log(`[${ym}] 无审批单`);
        continue;
      }

      console.log(`[${ym}] 发现 ${spList.length} 条审批单，开始同步...`);

      let monthSynced = 0;
      let monthSkipped = 0;
      let monthFailed = 0;

      for (const spNo of spList) {
        try {
          const result = await wechatSyncService.syncBySpNo(spNo);
          if (result.handled) {
            monthSynced++;
          } else {
            monthSkipped++;
          }
        } catch (e) {
          monthFailed++;
          // 只打印前几个错误避免刷屏
          if (monthFailed <= 3) {
            console.log(`  ✗ ${spNo}: ${e.message}`);
          }
        }
        // 控制频率
        await sleep(300);
      }

      totalSynced += monthSynced;
      totalSkipped += monthSkipped;
      totalFailed += monthFailed;

      console.log(`  ✓ 新增=${monthSynced} 跳过=${monthSkipped} 失败=${monthFailed}`);

      // 如果该月有 100 条，可能还有更多（需要用 cursor 翻页）
      if (spList.length >= 100) {
        console.log(`  ⚠ 该月达到 100 条上限，可能有遗漏。建议按半月再跑一次。`);
      }

    } catch (e) {
      console.error(`[${ym}] 拉取失败: ${e.message}`);
      totalFailed++;
    }

    // 月份间间隔
    await sleep(500);
  }

  console.log(`\n===== 导入完成 =====`);
  console.log(`总拉取: ${totalFetched}`);
  console.log(`新增: ${totalSynced}`);
  console.log(`跳过: ${totalSkipped}`);
  console.log(`失败: ${totalFailed}`);

  process.exit(0);
}

main().catch(e => {
  console.error('脚本异常:', e.message);
  process.exit(1);
});
