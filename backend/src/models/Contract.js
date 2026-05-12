const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 合同模型
 */
const Contract = sequelize.define('Contract', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contract_no: {
    type: DataTypes.STRING(50),
    unique: true,
    comment: '合同编号'
  },
  type: {
    type: DataTypes.ENUM('sale', 'purchase'),
    comment: '销售/采购'
  },
  title: {
    type: DataTypes.STRING(200),
    comment: '合同标题'
  },
  customer_id: {
    type: DataTypes.INTEGER,
    comment: '客户ID（销售合同）'
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    comment: '供应商ID（采购合同）'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '合同金额'
  },
  paid_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '已收/已付金额'
  },
  sign_date: {
    type: DataTypes.DATEONLY,
    comment: '签订日期'
  },
  expire_date: {
    type: DataTypes.DATEONLY,
    comment: '到期日期'
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'completed', 'terminated'),
    defaultValue: 'draft',
    comment: '状态'
  },
  project_id: {
    type: DataTypes.INTEGER,
    comment: '关联交易项目'
  },
  attachment_url: {
    type: DataTypes.STRING(500),
    comment: '合同扫描件COS地址'
  },
  owner_id: {
    type: DataTypes.INTEGER,
    comment: '负责人（关联users.id）'
  },
  sp_no: {
    type: DataTypes.STRING(50),
    comment: '关联企业微信审批单号'
  },
  confirm_status: {
    type: DataTypes.ENUM('pending', 'confirmed'),
    defaultValue: 'confirmed',
    comment: '确认状态'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人'
  }
}, {
  tableName: 'contracts',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = Contract;
