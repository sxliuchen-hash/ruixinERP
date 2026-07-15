/**
 * ============================================================
 * 系统消息服务（NotificationService）
 * ============================================================
 *
 * 【业务定位】
 *   系统内置的消息中心，承载各类提醒（合同到期、年费到期等）。
 *   企微推送（T11）日后可复用这层：消息先 save 到 notifications，
 *   再调用 wechatMessageService 发送，保证两端内容一致。
 *
 * 【API 列表】
 *   - getList / getUnreadCount / markRead / markAllRead / remove
 *   - upsert   幂等创建（同 dedupe_key 的未读消息只保留一条）
 *   - broadcast 给一组用户批量创建（广播 admin/合同负责人等）
 *
 * 【权限】
 *   self 只能看自己的消息；all 可额外读取 user_id=NULL 的系统广播。
 *   系统广播是共享只读记录，任何用户都不能标记已读或删除。
 *   主项目角色不在这里解释，userRole 仅用于旧会话兼容。
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Notification = require('../models/Notification');
const { NotFoundError, ValidationError, ForbiddenError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const logger = require('../utils/logger');

const DENY_NOTIFICATION_FILTER = Object.freeze({ user_id: -1 });

function normalizeNotificationFilter(dataFilter, userId, userRole) {
  if (dataFilter && typeof dataFilter === 'object' && !Array.isArray(dataFilter)) {
    const keys = Reflect.ownKeys(dataFilter);
    if (keys.length === 0) {
      return { [Op.or]: [{ user_id: userId }, { user_id: null }] };
    }
    if (keys.length === 1 && keys[0] === 'user_id') {
      const scopedUserId = Number(dataFilter.user_id);
      return Number.isInteger(scopedUserId) && scopedUserId > 0
        ? { user_id: scopedUserId }
        : { ...DENY_NOTIFICATION_FILTER };
    }
    return { ...DENY_NOTIFICATION_FILTER };
  }

  if (userRole === 'admin') {
    return { [Op.or]: [{ user_id: userId }, { user_id: null }] };
  }
  if (userRole === 'process' || userRole === 'agent') return { user_id: userId };
  return { ...DENY_NOTIFICATION_FILTER };
}

function normalizeNotificationWriteFilter(dataFilter, userId, userRole) {
  const readFilter = normalizeNotificationFilter(dataFilter, userId, userRole);
  const keys = Reflect.ownKeys(readFilter);

  if (keys.length === 1 && keys[0] === 'user_id' && readFilter.user_id === userId) {
    return { user_id: userId };
  }
  if (keys.length === 1 && keys[0] === Op.or) {
    return { user_id: userId };
  }
  return { ...DENY_NOTIFICATION_FILTER };
}

function assertWritableNotification(notification) {
  if (notification?.user_id === null || notification?.user_id === undefined) {
    throw new ForbiddenError('系统广播为共享只读消息，不能修改或删除');
  }
}

class NotificationService {
  /**
   * 获取当前用户的消息列表
   *
   * 返回：
   *   - user_id === userId 的消息
   *   - all scope 时额外包含 user_id IS NULL 的系统广播
   */
  async getList(query, userId, userRole, dataFilter) {
    const { page, limit, offset } = parsePagination(query);
    const { type, is_read, level } = query;

    const where = normalizeNotificationFilter(dataFilter, userId, userRole);

    if (type) where.type = type;
    if (is_read !== undefined && is_read !== '') {
      where.is_read = parseInt(is_read, 10);
    }
    if (level) where.level = level;

    const data = await Notification.findAndCountAll({
      where,
      order: [['create_time', 'DESC']],
      offset,
      limit
    });

    const list = data.rows.map((row) => {
      const item = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      if (item.user_id === null || item.user_id === undefined) {
        return { ...item, is_read: 1, read_time: null, readonly: true };
      }
      return { ...item, readonly: false };
    });

    return {
      list,
      pagination: {
        page,
        limit,
        total: data.count,
        totalPages: Math.ceil(data.count / limit)
      }
    };
  }

  /**
   * 未读消息数（用于顶栏红点）
   */
  async getUnreadCount(userId, userRole, dataFilter) {
    const where = {
      ...normalizeNotificationWriteFilter(dataFilter, userId, userRole),
      is_read: 0
    };
    return await Notification.count({ where });
  }

  /**
   * 标记单条已读
   */
  async markRead(id, userId, userRole, dataFilter) {
    const n = await Notification.findOne({
      where: { id, ...normalizeNotificationWriteFilter(dataFilter, userId, userRole) }
    });
    if (!n) throw new NotFoundError('消息不存在');
    assertWritableNotification(n);

    if (!n.is_read) {
      await n.update({ is_read: 1, read_time: new Date() });
    }
    return n;
  }

  /**
   * 批量已读（当前用户所有未读）
   */
  async markAllRead(userId, userRole, dataFilter) {
    const where = {
      ...normalizeNotificationWriteFilter(dataFilter, userId, userRole),
      is_read: 0
    };
    const [affected] = await Notification.update(
      { is_read: 1, read_time: new Date() },
      { where }
    );
    return { affected };
  }

  /**
   * 删除消息
   */
  async remove(id, userId, userRole, dataFilter) {
    const n = await Notification.findOne({
      where: { id, ...normalizeNotificationWriteFilter(dataFilter, userId, userRole) }
    });
    if (!n) throw new NotFoundError('消息不存在');
    assertWritableNotification(n);
    await n.destroy();
    return { id };
  }

  /**
   * 幂等创建：同 dedupe_key 的未读消息只保留一条
   *
   * 行为：
   *   - 如果 (user_id, source_type, source_id, dedupe_key) 已存在未读记录 → 跳过
   *   - 否则 → 创建新消息
   *
   * @param {Object} data
   * @param {number|null} data.user_id
   * @param {string} data.type
   * @param {string} [data.level='info']
   * @param {string} data.title
   * @param {string} [data.content]
   * @param {string} [data.link]
   * @param {string} [data.source_type]
   * @param {number} [data.source_id]
   * @param {string} [data.dedupe_key]
   * @returns {Promise<{created: boolean, notification: Notification}>}
   */
  async upsert(data) {
    if (!data.type) throw new ValidationError('消息 type 不能为空');
    if (!data.title) throw new ValidationError('消息 title 不能为空');

    // 幂等检查
    if (data.dedupe_key) {
      const existing = await Notification.findOne({
        where: {
          user_id: data.user_id || null,
          source_type: data.source_type || null,
          source_id: data.source_id || null,
          dedupe_key: data.dedupe_key,
          is_read: 0
        }
      });
      if (existing) {
        return { created: false, notification: existing };
      }
    }

    const notification = await Notification.create({
      user_id: data.user_id || null,
      type: data.type,
      level: data.level || 'info',
      title: data.title,
      content: data.content || null,
      link: data.link || null,
      source_type: data.source_type || null,
      source_id: data.source_id || null,
      dedupe_key: data.dedupe_key || null,
      is_read: 0
    });

    return { created: true, notification };
  }

  /**
   * 广播给多个用户
   *
   * @param {number[]} userIds 目标用户 ID 数组，空数组则广播（user_id=NULL，给 admin）
   * @param {Object} data 消息模板（同 upsert）
   * @returns {Promise<{count: number, skipped: number}>}
   */
  async broadcast(userIds, data) {
    let count = 0, skipped = 0;
    const targets = (userIds && userIds.length) ? userIds : [null];
    for (const uid of targets) {
      const result = await this.upsert({ ...data, user_id: uid });
      if (result.created) count++;
      else skipped++;
    }
    return { count, skipped };
  }

  /**
   * 清理陈旧的已读消息（默认 30 天前）
   *
   * @param {number} [days=30]
   * @returns {Promise<number>} 删除条数
   */
  async cleanup(days) {
    const d = days || 30;
    const result = await sequelize.query(
      `DELETE FROM notifications
       WHERE is_read = 1
         AND read_time IS NOT NULL
         AND read_time < DATE_SUB(NOW(), INTERVAL :days DAY)`,
      { replacements: { days: d }, type: QueryTypes.DELETE }
    );
    logger.info(`[NotificationService] 清理已读消息 ${d} 天前`, { result });
    return result;
  }
}

module.exports = new NotificationService();
module.exports.normalizeNotificationFilter = normalizeNotificationFilter;
module.exports.normalizeNotificationWriteFilter = normalizeNotificationWriteFilter;
module.exports.assertWritableNotification = assertWritableNotification;
