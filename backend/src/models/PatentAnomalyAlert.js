/**
 * ============================================================
 * 专利异常告警模型（PatentAnomalyAlert）
 * ============================================================
 * 对应数据表：patent_anomaly_alerts
 *
 * 【业务定位】
 *   定时扫描 IP 系统返回的专利全量信息，发现以下异常即告警：
 *   - pledge       新增质押记录
 *   - license      新增许可记录
 *   - change       新增变更记录（最高危险，可能被偷转）
 *   - transfer_fee 出现"著录项目变更费"
 *   - legal_status 法律状态发生重大变化
 *
 * 【告警等级】
 *   - danger   红色：变更记录、著录项目变更费（疑似转让）
 *   - warning  橙色：质押、许可
 *   - info     蓝色：普通法律状态变化
 *
 * 【去重机制】
 *   dedupe_key = `${anomalyType}_${eventDate}_${eventHash}`
 *   保证同一事件不会重复告警
 *
 * 【处理流程】
 *   告警创建 → 系统消息推送给 admin → 管理员查看 → 标记已处理
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PatentAnomalyAlert = sequelize.define('PatentAnomalyAlert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  inventory_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联 patent_inventory.id'
  },
  patent_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '专利号（冗余）'
  },
  anomaly_type: {
    type: DataTypes.ENUM('pledge', 'license', 'change', 'transfer_fee', 'legal_status', 'other'),
    allowNull: false,
    comment: '异常类型'
  },
  severity: {
    type: DataTypes.ENUM('info', 'warning', 'danger'),
    defaultValue: 'warning',
    comment: '严重程度'
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '告警标题'
  },
  content: {
    type: DataTypes.TEXT,
    comment: '告警详情'
  },
  event_date: {
    type: DataTypes.DATEONLY,
    comment: '事件发生日期'
  },
  detected_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '检测时间'
  },
  is_resolved: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
    comment: '是否已处理'
  },
  resolved_by: {
    type: DataTypes.INTEGER,
    comment: '处理人'
  },
  resolved_at: {
    type: DataTypes.DATE,
    comment: '处理时间'
  },
  resolution_note: {
    type: DataTypes.TEXT,
    comment: '处理备注'
  },
  dedupe_key: {
    type: DataTypes.STRING(150),
    comment: '去重键'
  }
}, {
  tableName: 'patent_anomaly_alerts',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false,
  indexes: [
    { fields: ['inventory_id'] },
    { fields: ['patent_no'] },
    { fields: ['anomaly_type'] },
    { fields: ['severity'] },
    { fields: ['is_resolved'] },
    { fields: ['detected_at'] },
    { fields: ['inventory_id', 'dedupe_key'], unique: true }
  ]
});

module.exports = PatentAnomalyAlert;
