const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 客户模型
 */
const Customer = sequelize.define('Customer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '客户名称'
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
  invoice_title: {
    type: DataTypes.STRING(200),
    comment: '开票抬头'
  },
  tax_no: {
    type: DataTypes.STRING(50),
    comment: '税号'
  },
  invoice_bank: {
    type: DataTypes.STRING(100),
    comment: '开票银行'
  },
  invoice_account: {
    type: DataTypes.STRING(50),
    comment: '开票账号'
  },
  main_user_id: {
    type: DataTypes.INTEGER,
    comment: '关联主项目users.id（业务员）'
  },
  remark: {
    type: DataTypes.STRING(500),
    comment: '备注'
  }
}, {
  tableName: 'customers',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = Customer;
