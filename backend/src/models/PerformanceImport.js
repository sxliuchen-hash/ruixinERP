/**
 * ============================================================
 * 业绩上传批次模型（PerformanceImport）
 * ============================================================
 * 对应数据表：performance_imports
 *
 * 【业务定位】
 *   每月人工上传一份业绩统计表，一次上传 = 一个批次。
 *   批次先为草稿（draft），人工核对无误后确认（confirmed），
 *   确认后明细参与提成计算。
 *
 * 【状态】
 *   draft     ：草稿（可重传覆盖、可删除）
 *   confirmed ：已确认（锁定，参与提成；如需修改先作废/删除重传）
 *
 * 【关联】
 *   hasMany PerformanceRecord（明细）
 * ============================================================
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PerformanceImport = sequelize.define('PerformanceImport', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '业绩归属年份'
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '业绩归属月份(1-12)'
  },
  file_name: {
    type: DataTypes.STRING(255),
    comment: '上传文件名'
  },
  record_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '明细条数'
  },
  total_performance: {
    type: DataTypes.DECIMAL(14, 2),
    defaultValue: 0,
    comment: '核定业绩合计'
  },
  status: {
    type: DataTypes.ENUM('draft', 'confirmed'),
    defaultValue: 'draft',
    comment: '状态：草稿/已确认'
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    comment: '上传人（主项目 users.id）'
  },
  confirmed_by: {
    type: DataTypes.INTEGER,
    comment: '确认人'
  },
  confirmed_at: {
    type: DataTypes.DATE,
    comment: '确认时间'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  }
}, {
  tableName: 'performance_imports',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['year', 'month'] },
    { fields: ['status'] }
  ]
});

module.exports = PerformanceImport;
