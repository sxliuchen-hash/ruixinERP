/**
 * ============================================================
 * 合同到期提醒定时任务（ContractReminderJob）
 * ============================================================
 *
 * 【触发时间】每日 09:00
 *
 * 【业务规则】
 *   1) 查询未来 30/7 天内到期的 active 状态合同
 *   2) 每个合同给其 owner_id 生成一条消息；owner_id 为空时广播给 admin
 *   3) 按 dedupe_key 去重：同一合同同一天同一阈值（30d/7d）只生成一次
 *
 * 【消息等级】
 *   ≤ 7 天：danger（红色，紧急）
 *   ≤ 30 天：warning（橙色，警告）
 *
 * 【企微推送】
 *   T11 上线后会在此处追加 wechatMessageService.send 调用；当前仅写系统消息。
 * ============================================================
 */

const { Op } = require('sequelize');
const Contract = require('../models/Contract');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const WARNING_DAYS = 30;
const DANGER_DAYS = 7;

/**
 * 执行一次合同到期提醒
 *
 * @returns {Promise<{checked: number, created: number}>}
 */
async function run() {
  const start = Date.now();
  logger.info('[ContractReminderJob] 开始扫描');

  try {
    // 用本地（进程时区 Asia/Shanghai）日期，避免 toISOString 转 UTC 产生 ±1 天偏差
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const inDays = (n) => {
      const d = new Date(now);
      d.setDate(d.getDate() + n);
      return fmt(d);
    };

    const todayStr = fmt(now);
    const warningCutoff = inDays(WARNING_DAYS);

    // 查询 30 天内到期的 active 合同
    const contracts = await Contract.findAll({
      where: {
        status: 'active',
        expire_date: {
          [Op.gte]: todayStr,
          [Op.lte]: warningCutoff
        }
      },
      attributes: ['id', 'contract_no', 'title', 'type', 'expire_date', 'owner_id', 'amount']
    });

    let created = 0;
    for (const c of contracts) {
      // 计算距离到期还有多少天（以 UTC 锚定的日期字符串相减，避免时区误差）
      const daysLeft = Math.round(
        (Date.parse(String(c.expire_date).slice(0, 10) + 'T00:00:00Z') - Date.parse(todayStr + 'T00:00:00Z')) / 86400000
      );

      // 7 天内 → danger，30 天内 → warning
      const threshold = daysLeft <= DANGER_DAYS ? DANGER_DAYS : WARNING_DAYS;
      const level = daysLeft <= DANGER_DAYS ? 'danger' : 'warning';

      const dedupeKey = `${threshold}d_${todayStr}`;
      const typeLabel = c.type === 'sale' ? '销售' : '采购';

      const result = await notificationService.upsert({
        user_id: c.owner_id || null,
        type: 'contract_expire',
        level,
        title: `${typeLabel}合同 ${c.contract_no} 还有 ${daysLeft} 天到期`,
        content: `合同标题：${c.title || '-'}\n合同金额：¥${parseFloat(c.amount || 0).toLocaleString('zh-CN')}\n到期日期：${c.expire_date}\n请及时跟进合同执行进度。`,
        link: `/contracts/${c.id}`,
        source_type: 'contract',
        source_id: c.id,
        dedupe_key: dedupeKey
      });

      if (result.created) created++;
    }

    logger.info('[ContractReminderJob] 完成', {
      checked: contracts.length,
      created,
      cost_ms: Date.now() - start
    });

    return { checked: contracts.length, created };
  } catch (error) {
    logger.error('[ContractReminderJob] 失败', { error: error.message, stack: error.stack });
    throw error;
  }
}

module.exports = { run };
