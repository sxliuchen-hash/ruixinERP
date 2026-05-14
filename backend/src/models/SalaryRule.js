/**
 * ============================================================
 * 薪资规则配置模型（SalaryRule）
 * ============================================================
 * 存储可编辑的薪资计算规则，包括：
 *   - 销售提成阶梯（超额累进）
 *   - 职级津贴配置
 *   - 社保公积金参数
 *   - 采购提成阶梯
 *   - 其他薪资参数
 *
 * 设计为 key-value 形式，value 用 JSON 存储复杂结构。
 * 每条规则有 category 分类，便于前端分组展示。
 * ============================================================
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SalaryRule = sequelize.define('SalaryRule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  category: {
    type: DataTypes.ENUM('commission', 'grade', 'social_insurance', 'purchase_commission', 'general'),
    allowNull: false,
    comment: '规则分类：提成/职级/社保/采购提成/通用'
  },
  rule_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '规则键名（唯一标识）'
  },
  rule_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '规则名称（中文展示）'
  },
  rule_value: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '规则值（JSON 格式）'
  },
  description: {
    type: DataTypes.STRING(500),
    comment: '规则说明'
  },
  editable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否允许编辑'
  }
}, {
  tableName: 'salary_rules',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = SalaryRule;
