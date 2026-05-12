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
 *   用户只能看/改自己的消息 + NULL 广播消息（admin）
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Notification = require('../models/Notification');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * 获取当前用户的消息列表
   *
   * 返回：
   *   - user_id === userId 的消息
   *   - 或 user_id IS NULL（广播给 admin）且当前角色是 admin
   */
  async getList(query, userId, userRole) {
    const { page, limit, offset } = parsePagination(query);
    const { type, is_read, level } = query;

    const where = {};
    // 用户可见范围
    const isAdmin = userRole === 'admin';
    if (isAdmin) {
      where[Op.or] = [{ user_id: userId }, { user_id: null }];
    } else {
      where.user_id = userId;
    }

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

    return {
      list: data.rows,
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
  async getUnreadCount(userId, userRole) {
    const where = { is_read: 0 };
    if (userRole === 'admin') {
      where[Op.or] = [{ user_id: userId }, { user_id: null }];
    } else {
      where.user_id = userId;
    }
    return await Notification.count({ where });
  }

  /**
   * 标记单条已读
   */
  async markRead(id, userId, userRole) {
    const n = await Notification.findByPk(id);
    if (!n) throw new NotFoundError('消息不存在');

    // 权限检查：非 admin 只能改自己的
    if (userRole !== 'admin' && n.user_id !== userId) {
      throw new ValidationError('无权操作该消息');
    }
    if (n.user_id === null && userRole !== 'admin') {
      throw new ValidationError('广播消息仅 admin 可操作');
    }

    if (!n.is_read) {
      await n.update({ is_read: 1, read_time: new Date() });
    }
    return n;
  }

  /**
   * 批量已读（当前用户所有未读）
   */
  async markAllRead(userId, userRole) {
    const where = { is_read: 0 };
    if (userRole === 'admin') {
      where[Op.or] = [{ user_id: userId }, { user_id: null }];
    } else {
      where.user_id = userId;
    }
    const [affected] = await Notification.update(
      { is_read: 1, read_time: new Date() },
      { where }
    );
    return { affected };
  }

  /**
   * 删除消息
   */
  async remove(id, userId, userRole) {
    const n = await Notification.findByPk(id);
    if (!n) throw new NotFoundError('消息不存在');

    if (userRole !== 'admin' && n.user_id !== userId) {
      throw new ValidationError('无权删除该消息');
    }
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
