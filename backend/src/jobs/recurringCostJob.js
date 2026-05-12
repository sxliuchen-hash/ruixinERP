/**
 * ============================================================
 * 固定月费自动生成定时任务（RecurringCostJob）
 * ============================================================
 *
 * 【用途】
 *   每月 1 日 0:00 自动把 is_recurring=1 的成本记录复制一份到新月份。
 *   覆盖常见场景：房租、工资、网络、社保等固定周期性支出。
 *
 * 【模板选取】
 *   costService.generateRecurringRecords 内部规则：
 *   - 取每个 (category_id, user_id) 组合最新的 is_recurring=1 记录作为模板
 *   - 若目标月份已有同组合的记录，跳过（幂等保护）
 *
 * 【人工复核】
 *   自动生成的记录 summary 会带"（自动生成）"后缀，便于识别。
 *   金额、账户等字段完全继承模板，首次运行后需财务人工核对。
 *
 * 【手动触发】
 *   除 cron 外，管理员可通过 POST /api/v1/costs/recurring/generate 手动触发，
 *   body 可带 {month: 'YYYY-MM'} 指定目标月份（默认当前月）。
 * ============================================================
 */

const logger = require('../utils/logger');
const costService = require('../services/costService');

/**
 * 执行一次固定月费生成
 *
 * @param {string} [targetMonth='YYYY-MM']
 * @returns {Promise<{generated: number, month: string}>}
 */
async function run(targetMonth) {
  const start = Date.now();
  logger.info('[RecurringCostJob] 开始生成固定月费', { targetMonth: targetMonth || 'current' });

  try {
    const result = await costService.generateRecurringRecords(targetMonth);
    logger.info('[RecurringCostJob] 完成', {
      month: result.month,
      generated: result.generated,
      cost_ms: Date.now() - start
    });
    return result;
  } catch (error) {
    logger.error('[RecurringCostJob] 失败', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = { run };
