const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 账户间转账模型
 */
const AccountTransfer = sequelize.define('AccountTransfer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  from_account_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '转出账户'
  },
  to_account_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '转入账户'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '转账金额'
  },
  transfer_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '转账日期'
  },
  remark: {
    type: DataTypes.STRING(255),
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人'
  }
}, {
  tableName: 'account_transfers',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false
});

module.exports = AccountTransfer;
