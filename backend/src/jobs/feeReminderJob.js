/**
 * ============================================================
 * 专利年费到期提醒定时任务（FeeReminderJob）
 * ============================================================
 *
 * 【触发时间】每日 09:00
 *
 * 【业务规则】
 *   1) 复用 inventoryService.getExpiring(60) 查询 60 天内到期的在库专利
 *   2) 按剩余天数分档发送不同等级的提醒：
 *      ≤ 7 天：danger，每日提醒
 *      ≤ 30 天：warning，每日提醒（幂等去重）
 *      ≤ 60 天：info，每日提醒
 *   3) 消息广播给 admin（user_id=NULL），专利没有明确"负责人"概念
 *   4) 去重：同一专利同一天同一阈值只生成一次消息
 *
 * 【企微推送】
 *   T11 上线后可在此处扩展推送，当前仅写系统消息。
 * ============================================================
 */

const inventoryService = require('../services/inventoryService');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const DANGER_DAYS = 7;
const WARNING_DAYS = 30;
const INFO_DAYS = 60;

/**
 * 判定消息等级和阈值
 */
function deriveLevel(daysLeft) {
  if (daysLeft <= DANGER_DAYS) return { level: 'danger', threshold: DANGER_DAYS };
  if (daysLeft <= WARNING_DAYS) return { level: 'warning', threshold: WARNING_DAYS };
  return { level: 'info', threshold: INFO_DAYS };
}

/**
 * 执行一次年费到期扫描
 *
 * @returns {Promise<{checked: number, created: number}>}
 */
async function run() {
  const start = Date.now();
  logger.info('[FeeReminderJob] 开始扫描');

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    // 复用 inventoryService 的查询逻辑（60 天窗口，已过滤在库）
    const list = await inventoryService.getExpiring({ days: INFO_DAYS });

    let created = 0;
    for (const item of list) {
      const { level, threshold } = deriveLevel(item.days_left);
      const dedupeKey = `${threshold}d_${todayStr}`;

      const result = await notificationService.upsert({
        user_id: null, // 广播给 admin
        type: 'fee_deadline',
        level,
        title: `专利 ${item.patent_no} 还有 ${item.days_left} 天到年费日`,
        content: `专利名称：${item.patent_name || '-'}\n技术领域：${item.tech_field || '-'}\n到期日期：${item.next_fee_deadline}\n当前售价：¥${Number(item.current_price).toLocaleString('zh-CN')}\n累计维持成本：¥${Number(item.total_maintain_cost).toLocaleString('zh-CN')}\n请评估是否继续维持。`,
        link: `/inventory/${item.id}`,
        source_type: 'patent_inventory',
        source_id: item.id,
        dedupe_key: dedupeKey
      });

      if (result.created) created++;
    }

    logger.info('[FeeReminderJob] 完成', {
      checked: list.length,
      created,
      cost_ms: Date.now() - start
    });

    return { checked: list.length, created };
  } catch (error) {
    logger.error('[FeeReminderJob] 失败', { error: error.message, stack: error.stack });
    throw error;
  }
}

module.exports = { run };
