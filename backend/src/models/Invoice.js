const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 发票模型
 */
const Invoice = sequelize.define('Invoice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.ENUM('output', 'input'),
    allowNull: false,
    comment: '销项/进项'
  },
  invoice_type: {
    type: DataTypes.ENUM('normal', 'special'),
    allowNull: false,
    comment: '普票/专票'
  },
  invoice_no: {
    type: DataTypes.STRING(50),
    comment: '发票号'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '金额（不含税）'
  },
  tax_amount: {
    type: DataTypes.DECIMAL(12, 2),
    comment: '税额'
  },
  total_amount: {
    type: DataTypes.DECIMAL(12, 2),
    comment: '价税合计'
  },
  invoice_date: {
    type: DataTypes.DATEONLY,
    comment: '开票日期'
  },
  contract_id: {
    type: DataTypes.INTEGER,
    comment: '关联合同'
  },
  customer_id: {
    type: DataTypes.INTEGER,
    comment: '客户（销项）'
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    comment: '供应商（进项）'
  },
  status: {
    type: DataTypes.ENUM('pending', 'issued', 'cancelled'),
    defaultValue: 'pending',
    comment: '状态'
  },
  sp_no: {
    type: DataTypes.STRING(50),
    comment: '关联审批单号'
  },
  remark: {
    type: DataTypes.STRING(500),
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人'
  }
}, {
  tableName: 'invoices',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = Invoice;
