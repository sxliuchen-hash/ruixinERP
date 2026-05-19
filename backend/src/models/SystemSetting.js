/**
 * ============================================================
 * 系统设置模型（SystemSetting）
 * ============================================================
 * 对应数据表：system_settings
 *
 * 【业务定位】
 *   key-value 形式的系统配置，supports JSON 值
 *
 * 【常用 key】
 *   channel_sales_cost 渠道销售成本（按专利类型）
 *     value: { "发明": 1000, "实用新型": 200, "外观": 200, "default": 500 }
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SystemSetting = sequelize.define('SystemSetting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  setting_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: '设置项键名'
  },
  setting_value: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '设置项值（JSON）'
  },
  description: {
    type: DataTypes.STRING(500),
    comment: '描述'
  },
  category: {
    type: DataTypes.STRING(50),
    defaultValue: 'general',
    comment: '分类'
  },
  updated_by: {
    type: DataTypes.INTEGER,
    comment: '最后修改人'
  }
}, {
  tableName: 'system_settings',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['setting_key'], unique: true },
    { fields: ['category'] }
  ]
});

module.exports = SystemSetting;
