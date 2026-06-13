/**
 * ============================================================
 * 冗余聚合字段对账校验任务（reconcileAggregatesJob）
 * ============================================================
 * 背景：
 *   系统多处使用冗余字段缓存聚合结果（合同 paid_amount、借款 repaid_amount、
 *   专利 total_maintain_cost 等），由各 service 在写操作时维护。
 *   一旦出现异常路径/历史数据/并发问题，冗余值可能与明细漂移。
 *
 * 职责：
 *   定期比对冗余字段与实时聚合值，发现差异（>0.01）即记录告警日志，
 *   便于人工核查与修复。
 *
 * 设计原则：
 *   只读 + 告警，不自动改数——避免「自愈」掩盖真实的业务/代码缺陷。
 * ============================================================
 */
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const logger = require('../utils/logger');

async function run() {
  logger.info('[reconcileAggregates] 冗余字段对账开始');
  const issues = [];

  // 1. 合同 paid_amount = SUM(business + confirmed 的 payments)
  const contractDrift = await sequelize.query(
    `SELECT * FROM (
       SELECT c.id, c.contract_no,
              CAST(c.paid_amount AS DECIMAL(14,2)) AS stored,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.contract_id = c.id AND p.category = 'business'
                          AND p.confirm_status = 'confirmed'), 0) AS actual
         FROM contracts c
     ) t WHERE ABS(t.stored - t.actual) > 0.01`,
    { type: QueryTypes.SELECT }
  );
  contractDrift.forEach((r) =>
    issues.push(`合同#${r.id}(${r.contract_no}) paid_amount 存储=${r.stored} 实际=${r.actual}`)
  );

  // 2. 借款 repaid_amount = SUM(loan_repayments)
  const loanDrift = await sequelize.query(
    `SELECT * FROM (
       SELECT l.id,
              CAST(l.repaid_amount AS DECIMAL(14,2)) AS stored,
              COALESCE((SELECT SUM(r.amount) FROM loan_repayments r WHERE r.loan_id = l.id), 0) AS actual
         FROM loans l
     ) t WHERE ABS(t.stored - t.actual) > 0.01`,
    { type: QueryTypes.SELECT }
  );
  loanDrift.forEach((r) =>
    issues.push(`借款#${r.id} repaid_amount 存储=${r.stored} 实际=${r.actual}`)
  );

  // 3. 专利 total_maintain_cost = SUM(patent_annual_fees)
  const inventoryDrift = await sequelize.query(
    `SELECT * FROM (
       SELECT i.id, i.patent_no,
              CAST(i.total_maintain_cost AS DECIMAL(14,2)) AS stored,
              COALESCE((SELECT SUM(f.amount) FROM patent_annual_fees f WHERE f.inventory_id = i.id), 0) AS actual
         FROM patent_inventory i
     ) t WHERE ABS(t.stored - t.actual) > 0.01`,
    { type: QueryTypes.SELECT }
  );
  inventoryDrift.forEach((r) =>
    issues.push(`专利#${r.id}(${r.patent_no}) total_maintain_cost 存储=${r.stored} 实际=${r.actual}`)
  );

  if (issues.length > 0) {
    logger.warn(`[reconcileAggregates] 发现 ${issues.length} 处冗余字段漂移：\n${issues.join('\n')}`);
  } else {
    logger.info('[reconcileAggregates] 对账完成，冗余字段一致');
  }

  return { count: issues.length, issues };
}

module.exports = { run };
