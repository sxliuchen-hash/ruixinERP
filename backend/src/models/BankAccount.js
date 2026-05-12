const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 银行账户模型
 */
const BankAccount = sequelize.define('BankAccount', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '账户名称'
  },
  bank_name: {
    type: DataTypes.STRING(100),
    comment: '开户行'
  },
  account_no: {
    type: DataTypes.STRING(50),
    unique: true,
    comment: '账号'
  },
  account_type: {
    type: DataTypes.ENUM('public', 'private'),
    allowNull: false,
    comment: '账户类型：对公/对私'
  },
  initial_balance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.00,
    comment: '期初余额'
  },
  status: {
    type: DataTypes.TINYINT,
    defaultValue: 1,
    comment: '1启用/0停用'
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
  tableName: 'bank_accounts',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = BankAccount;
