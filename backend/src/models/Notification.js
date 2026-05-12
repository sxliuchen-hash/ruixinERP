/**
 * ============================================================
 * 系统消息模型（Notification）
 * ============================================================
 * 对应数据表：notifications
 *
 * 【业务定位】
 *   系统内置的消息中心，承载各类提醒：
 *   - 合同到期提醒（T15）
 *   - 专利年费到期提醒（T15）
 *   - 企微审批同步失败重试提醒（T10 预留）
 *   - 管理员操作的系统通知（预留）
 *
 *   企微推送（T11）可以复用同一份数据源，消息生成→保存一份到 notifications
 *   →同时通过 wechatMessageService 推送出去，两端解耦。
 *
 * 【字段说明】
 *   user_id     ：接收人（主项目 users.id），NULL 表示广播给 admin
 *   type        ：消息类型（用于前端分组展示和筛选）
 *   level       ：严重程度 info/warning/danger
 *   title       ：简短标题
 *   content     ：详细内容（支持换行）
 *   link        ：点击跳转的前端路由（如 /contracts/123）
 *   source_type ：关联业务类型（用于去重和追溯）
 *   source_id   ：关联业务 ID
 *   is_read     ：是否已读
 *   read_time   ：读取时间
 *
 * 【幂等去重】
 *   同一个 (user_id, source_type, source_id, dedupe_key) 组合只保留一条未读消息，
 *   避免 cron 每日运行都生成重复提醒。dedupe_key 由 service 层生成（如 "30d_2026-06-10"）。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    comment: '接收人（主项目 users.id），NULL 表示广播给 admin'
  },
  type: {
    type: DataTypes.ENUM(
      'contract_expire',    // 合同到期
      'fee_deadline',       // 年费到期
      'approval_sync',      // 审批同步相关
      'system',             // 系统通知
      'other'
    ),
    allowNull: false,
    comment: '消息类型'
  },
  level: {
    type: DataTypes.ENUM('info', 'warning', 'danger'),
    defaultValue: 'info',
    comment: '严重程度'
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '简短标题'
  },
  content: {
    type: DataTypes.TEXT,
    comment: '详细内容'
  },
  link: {
    type: DataTypes.STRING(500),
    comment: '跳转链接（前端路由）'
  },
  source_type: {
    type: DataTypes.STRING(50),
    comment: '关联业务类型（如 contract/patent_inventory）'
  },
  source_id: {
    type: DataTypes.INTEGER,
    comment: '关联业务 ID'
  },
  dedupe_key: {
    type: DataTypes.STRING(100),
    comment: '去重键（同类消息日/窗口标识，同一天只建一次）'
  },
  is_read: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
    comment: '是否已读'
  },
  read_time: {
    type: DataTypes.DATE,
    comment: '读取时间'
  }
}, {
  tableName: 'notifications',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['type'] },
    { fields: ['is_read'] },
    { fields: ['source_type', 'source_id'] },
    { fields: ['dedupe_key'] },
    { fields: ['create_time'] }
  ]
});

module.exports = Notification;
