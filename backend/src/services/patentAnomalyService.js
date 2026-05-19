/**
 * ============================================================
 * 专利异常检测服务（PatentAnomalyService）
 * ============================================================
 *
 * 【职责】
 *   1) 解析 IP 系统返回的专利全量数据
 *   2) 检测一个月内出现的异常事件
 *   3) 写入 patent_anomaly_alerts 表（事务内去重）
 *   4) 同步给 Notification 推送给 admin
 *
 * 【检测规则】
 *   - pledge        新增质押记录（warning）
 *   - license       新增许可记录（warning）
 *   - change        新增变更记录（danger，疑似转让）
 *   - transfer_fee  费用列表中出现"著录项目变更费"（danger）
 *   - legal_status  法律状态变为"专利权终止/无效宣告/中止"等（danger）
 * ============================================================
 */

const PatentAnomalyAlert = require('../models/PatentAnomalyAlert');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');

// 一个月的毫秒数（用于判断"近期"）
const ONE_MONTH_MS = 30 * 24 * 3600 * 1000;

// 危险的法律状态关键词
const DANGEROUS_LEGAL_STATUS = [
  '专利权终止',
  '无效宣告',
  '权利转移',
  '专利权的转移'
];

class PatentAnomalyService {
  /**
   * 检测单个专利的异常并入库
   *
   * @param {Object} inventory - PatentInventory 实例（含 patent_no、id）
   * @param {Object} ipData    - IP 系统返回的 detail 数据（patent + detail + feesDue + feesPaid + dispatches + pledges + licenses + changes）
   * @returns {Promise<Array>} 新建的告警列表
   */
  async detectAndRecord(inventory, ipData) {
    if (!inventory || !ipData) return [];

    const alerts = [];
    const now = new Date();

    // 1) 检测质押
    if (Array.isArray(ipData.pledges)) {
      for (const pledge of ipData.pledges) {
        if (this._isRecent(pledge.startDate || pledge.eventDate || pledge.dispatchDate)) {
          alerts.push(this._buildAlert({
            inventory,
            type: 'pledge',
            severity: 'warning',
            title: `专利 ${inventory.patent_no} 新增质押记录`,
            content: `质押人：${pledge.pledger || '-'}\n出质人：${pledge.pledgee || pledge.holder || '-'}\n开始日期：${pledge.startDate || '-'}\n备注：${JSON.stringify(pledge)}`,
            eventDate: pledge.startDate || pledge.eventDate,
            dedupeKey: `pledge_${pledge.startDate || pledge.eventDate || ''}_${pledge.pledger || ''}`
          }));
        }
      }
    }

    // 2) 检测许可
    if (Array.isArray(ipData.licenses)) {
      for (const license of ipData.licenses) {
        if (this._isRecent(license.startDate || license.eventDate || license.dispatchDate)) {
          alerts.push(this._buildAlert({
            inventory,
            type: 'license',
            severity: 'warning',
            title: `专利 ${inventory.patent_no} 新增许可记录`,
            content: `被许可人：${license.licensee || '-'}\n许可类型：${license.licenseType || '-'}\n起止日期：${license.startDate || '-'} ~ ${license.endDate || '-'}\n备注：${JSON.stringify(license)}`,
            eventDate: license.startDate || license.eventDate,
            dedupeKey: `license_${license.startDate || license.eventDate || ''}_${license.licensee || ''}`
          }));
        }
      }
    }

    // 3) 检测变更（最危险）
    if (Array.isArray(ipData.changes)) {
      for (const change of ipData.changes) {
        if (this._isRecent(change.changeDate || change.eventDate)) {
          alerts.push(this._buildAlert({
            inventory,
            type: 'change',
            severity: 'danger',
            title: `⚠ 专利 ${inventory.patent_no} 出现著录项目变更，疑似被转让！`,
            content: `变更事项：${change.changeName || change.itemName || '-'}\n变更日期：${change.changeDate || '-'}\n变更内容：${change.changeContent || JSON.stringify(change)}\n请立即核实！`,
            eventDate: change.changeDate || change.eventDate,
            dedupeKey: `change_${change.changeDate || ''}_${change.changeName || change.itemName || ''}`
          }));
        }
      }
    }

    // 4) 检测著录项目变更费
    if (Array.isArray(ipData.feesDue)) {
      for (const fee of ipData.feesDue) {
        if (fee.feeName && fee.feeName.includes('著录项目变更费')) {
          alerts.push(this._buildAlert({
            inventory,
            type: 'transfer_fee',
            severity: 'danger',
            title: `⚠ 专利 ${inventory.patent_no} 出现著录项目变更费`,
            content: `费用名称：${fee.feeName}\n金额：¥${fee.amount || 0}\n截止日：${fee.deadline || '-'}\n该费用通常意味着专利权人或申请人发生变更，请立即核实！`,
            eventDate: fee.deadline,
            dedupeKey: `transfer_fee_${fee.deadline || ''}_${fee.feeName}`
          }));
        }
      }
    }
    if (Array.isArray(ipData.feesPaid)) {
      for (const fee of ipData.feesPaid) {
        if (fee.feeName && fee.feeName.includes('著录项目变更费') && this._isRecent(fee.paidDate)) {
          alerts.push(this._buildAlert({
            inventory,
            type: 'transfer_fee',
            severity: 'danger',
            title: `⚠ 专利 ${inventory.patent_no} 已缴纳著录项目变更费`,
            content: `费用名称：${fee.feeName}\n金额：¥${fee.amount || 0}\n缴费日：${fee.paidDate || '-'}\n缴费人：${fee.payer || '-'}\n该费用通常意味着专利权人发生变更，请立即核实！`,
            eventDate: fee.paidDate,
            dedupeKey: `transfer_fee_paid_${fee.paidDate || ''}_${fee.feeName}`
          }));
        }
      }
    }

    // 5) 检测危险的法律状态
    if (ipData.patent?.legalStatus) {
      const legalStatus = ipData.patent.legalStatus;
      const isDangerous = DANGEROUS_LEGAL_STATUS.some(keyword => legalStatus.includes(keyword));
      if (isDangerous) {
        alerts.push(this._buildAlert({
          inventory,
          type: 'legal_status',
          severity: 'danger',
          title: `⚠ 专利 ${inventory.patent_no} 法律状态异常：${legalStatus}`,
          content: `当前法律状态：${legalStatus}\n业务状态：${ipData.patent.patentStatusText || '-'}\n请立即核实专利权属！`,
          eventDate: now.toISOString().slice(0, 10),
          dedupeKey: `legal_${legalStatus}_${now.toISOString().slice(0, 10)}`
        }));
      }
    }

    // 入库（使用 findOrCreate 实现去重）
    const created = [];
    for (const alertData of alerts) {
      try {
        const [record, isNew] = await PatentAnomalyAlert.findOrCreate({
          where: {
            inventory_id: alertData.inventory_id,
            dedupe_key: alertData.dedupe_key
          },
          defaults: alertData
        });
        if (isNew) {
          created.push(record);
          // 同步推送系统消息
          await this._sendNotification(record);
        }
      } catch (e) {
        logger.error(`创建告警失败 ${inventory.patent_no}:`, e.message);
      }
    }

    return created;
  }

  /**
   * 获取告警列表
   *
   * @param {Object} query
   * @returns {Promise<{list, total}>}
   */
  async getList(query = {}) {
    const { Op } = require('sequelize');
    const PatentInventory = require('../models/PatentInventory');

    const page = parseInt(query.page, 10) || 1;
    const pageSize = parseInt(query.pageSize, 10) || 20;
    const offset = (page - 1) * pageSize;

    const where = {};
    if (query.severity) where.severity = query.severity;
    if (query.anomaly_type) where.anomaly_type = query.anomaly_type;
    if (query.is_resolved !== undefined && query.is_resolved !== '') {
      where.is_resolved = parseInt(query.is_resolved, 10);
    }
    if (query.patent_no) {
      where.patent_no = { [Op.like]: `%${query.patent_no}%` };
    }

    const { rows, count } = await PatentAnomalyAlert.findAndCountAll({
      where,
      include: [
        {
          model: PatentInventory,
          as: 'inventory',
          attributes: ['id', 'patent_no', 'patent_name', 'status', 'resource_type']
        }
      ],
      order: [['detected_at', 'DESC'], ['severity', 'DESC']],
      limit: pageSize,
      offset
    });

    return {
      list: rows,
      total: count,
      page,
      pageSize
    };
  }

  /**
   * 标记告警为已处理
   */
  async markResolved(alertId, userId, note) {
    const alert = await PatentAnomalyAlert.findByPk(alertId);
    if (!alert) return null;

    await alert.update({
      is_resolved: 1,
      resolved_by: userId,
      resolved_at: new Date(),
      resolution_note: note || null
    });

    return alert;
  }

  /**
   * 获取统计数据
   */
  async getOverview() {
    const { sequelize } = require('../config/database');
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(
      `SELECT severity, COUNT(*) as cnt
       FROM patent_anomaly_alerts
       WHERE is_resolved = 0
       GROUP BY severity`,
      { type: QueryTypes.SELECT }
    );

    const result = { danger: 0, warning: 0, info: 0, total: 0 };
    for (const r of rows) {
      result[r.severity] = parseInt(r.cnt, 10);
      result.total += parseInt(r.cnt, 10);
    }
    return result;
  }

  // ==================== 私有工具 ====================

  /** 判断日期字符串是否在最近一个月内 */
  _isRecent(dateStr) {
    if (!dateStr) return false;
    let date;
    if (/^\d{8}$/.test(dateStr)) {
      // YYYYMMDD
      date = new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`);
    } else {
      date = new Date(dateStr);
    }
    if (isNaN(date.getTime())) return false;

    const diff = Date.now() - date.getTime();
    return diff >= 0 && diff <= ONE_MONTH_MS;
  }

  /** 构建告警 payload */
  _buildAlert({ inventory, type, severity, title, content, eventDate, dedupeKey }) {
    return {
      inventory_id: inventory.id,
      patent_no: inventory.patent_no,
      anomaly_type: type,
      severity,
      title,
      content,
      event_date: eventDate || null,
      detected_at: new Date(),
      dedupe_key: dedupeKey
    };
  }

  /** 异常告警同步到系统消息中心 */
  async _sendNotification(alert) {
    try {
      await notificationService.upsert({
        user_id: null, // 广播给 admin
        type: 'system',
        level: alert.severity,
        title: alert.title,
        content: alert.content,
        link: `/inventory/${alert.inventory_id}`,
        source_type: 'patent_anomaly',
        source_id: alert.id,
        dedupe_key: alert.dedupe_key
      });
    } catch (e) {
      logger.warn(`异常告警通知推送失败:`, e.message);
    }
  }
}

module.exports = new PatentAnomalyService();
