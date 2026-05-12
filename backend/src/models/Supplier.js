const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 供应商模型
 */
const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '供应商名称'
  },
  contact_person: {
    type: DataTypes.STRING(50),
    comment: '联系人'
  },
  phone: {
    type: DataTypes.STRING(20),
    comment: '电话'
  },
  address: {
    type: DataTypes.STRING(500),
    comment: '地址'
  },
  bank_name: {
    type: DataTypes.STRING(100),
    comment: '开户行'
  },
  bank_account: {
    type: DataTypes.STRING(50),
    comment: '银行账号'
  },
  tax_rate: {
    type: DataTypes.DECIMAL(4, 2),
    comment: '税点'
  },
  remark: {
    type: DataTypes.STRING(500),
    comment: '备注'
  }
}, {
  tableName: 'suppliers',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = Supplier;
