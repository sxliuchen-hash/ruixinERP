/**
 * ============================================================
 * 业绩明细模型（PerformanceRecord）
 * ============================================================
 * 对应数据表：performance_records
 *
 * 【业务定位】
 *   每月上传业绩统计表的逐行明细。一行 = 一笔成交业务。
 *   "核定业绩"(performance_amount) 是提成计算基数；按 employee + 归属月
 *   汇总后套超额累进阶梯计算销售提成。
 *
 * 【归属月规则】
 *   业绩归属"尾款日期所在月"(final_payment_date)，提成在"归属月+1"工资条发放。
 *   year/month 冗余存储归属月，便于按月聚合。
 *
 * 【字段对应上传表列】
 *   姓名 → employee_name（落库时匹配 employee_id/user_id）
 *   业务类型 → business_type
 *   流水号 → serial_no
 *   专利号/项目号 → target_no
 *   专利名/项目名 → target_name
 *   合同金额 → contract_amount
 *   核定业绩 → performance_amount
 *   合同日期 → contract_date
 *   尾款日期 → final_payment_date
 *   是否全风险代理 → is_full_risk_agent（仅记录，不影响计提）
 *   备注 → remark
 *
 * 【关联】
 *   belongsTo PerformanceImport（批次）
 * ============================================================
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PerformanceRecord = sequelize.define('PerformanceRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batch_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '所属上传批次 ID'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '归属年份（尾款日期所在年）'
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '归属月份（尾款日期所在月）'
  },
  employee_id: {
    type: DataTypes.INTEGER,
    comment: '匹配到的员工 ID（匹配失败为空）'
  },
  user_id: {
    type: DataTypes.INTEGER,
    comment: '匹配到的主项目 users.id'
  },
  employee_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '上传时填写的姓名（业绩归属人）'
  },
  business_type: {
    type: DataTypes.STRING(50),
    comment: '业务类型（发明买卖/实用买卖/软著/商标等）'
  },
  serial_no: {
    type: DataTypes.STRING(100),
    comment: '业务流水号'
  },
  target_no: {
    type: DataTypes.STRING(100),
    comment: '专利号/项目号'
  },
  target_name: {
    type: DataTypes.STRING(500),
    comment: '专利名/项目名'
  },
  contract_amount: {
    type: DataTypes.DECIMAL(14, 2),
    defaultValue: 0,
    comment: '合同金额'
  },
  performance_amount: {
    type: DataTypes.DECIMAL(14, 2),
    defaultValue: 0,
    comment: '核定业绩（提成计算基数）'
  },
  contract_date: {
    type: DataTypes.DATEONLY,
    comment: '合同日期'
  },
  final_payment_date: {
    type: DataTypes.DATEONLY,
    comment: '尾款日期（决定归属月和发放月）'
  },
  is_full_risk_agent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否全风险代理（仅记录，不影响计提）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  }
}, {
  tableName: 'performance_records',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['batch_id'] },
    { fields: ['employee_id', 'year', 'month'] },
    { fields: ['year', 'month'] }
  ]
});

module.exports = PerformanceRecord;
