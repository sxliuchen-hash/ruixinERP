/**
 * ============================================================
 * 成本记录模型（CostRecord）
 * ============================================================
 * 对应数据表：cost_records
 *
 * 【用途】
 *   记录各类成本支出明细，来源包括：
 *   - 费用类收付款（category='fee' 的 payment）自动写入
 *   - 固定月费自动生成（Phase 3 recurringCostJob）
 *   - 手动录入（Phase 3 成本管理页面）
 *
 * 【关联关系】
 *   - category_id → cost_categories.id（必填）
 *   - payment_id  → payments.id（由费用类收付款自动写入时关联）
 *   - account_id  → bank_accounts.id（付款账户）
 *   - user_id     → users.id（人力成本时关联人员）
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CostRecord = sequelize.define('CostRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '成本类别ID'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '金额'
  },
  cost_month: {
    type: DataTypes.CHAR(7),
    comment: '所属月份（格式：2026-05）'
  },
  user_id: {
    type: DataTypes.INTEGER,
    comment: '关联人员（人力成本时）'
  },
  payment_id: {
    type: DataTypes.INTEGER,
    comment: '关联收付款记录ID（费用类payment自动写入时）'
  },
  account_id: {
    type: DataTypes.INTEGER,
    comment: '付款账户'
  },
  is_recurring: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
    comment: '是否固定月费'
  },
  summary: {
    type: DataTypes.STRING(500),
    comment: '摘要'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人'
  }
}, {
  tableName: 'cost_records',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['category_id'] },
    { fields: ['cost_month'] },
    { fields: ['payment_id'] },
    { fields: ['user_id'] }
  ]
});

module.exports = CostRecord;
