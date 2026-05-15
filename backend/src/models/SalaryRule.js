/**
 * ============================================================
 * 薪资规则配置模型（SalaryRule）
 * ============================================================
 * 存储可编辑的薪资计算规则，包括：
 *   - commission: 销售提成阶梯（超额累进）
 *   - grade: 职级津贴 + 季度考核阈值
 *   - social_insurance: 社保公积金参数
 *   - purchase_commission: 采购提成阶梯
 *   - general: 通用参数（全勤、日薪计算基数等）
 *
 * 每种规则类型只有一条记录（单例），通过 rule_type 区分。
 * rule_data 为 JSON 字段，存储具体规则参数。
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
  rule_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '规则类型：commission/grade/social_insurance/purchase_commission/general'
  },
  rule_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '规则名称（中文）'
  },
  rule_data: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '规则参数（JSON）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注说明'
  }
}, {
  tableName: 'salary_rules',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = SalaryRule;
