/**
 * ============================================================
 * 借款还款明细模型（LoanRepayment）
 * ============================================================
 * 对应数据表：loan_repayments
 *
 * 【业务定位】
 *   借款的分次还款记录，每笔还款：
 *   1) 写入一条 LoanRepayment
 *   2) 事务内聚合当前 loan 的所有 repayments，重算 Loan.repaid_amount
 *   3) 根据最新的 repaid_amount 自动更新 Loan.status（unpaid/partial/paid）
 *
 * 【账户联动】
 *   account_id 记录还款到账的账户，calculateBalance 聚合时计入收入。
 *
 * 【删除规则】
 *   删除某笔还款时同样需要重算父 loan 的 repaid_amount 和 status，
 *   相关事务逻辑在 LoanService 中实现。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LoanRepayment = sequelize.define('LoanRepayment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  loan_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联借款 ID'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '本次还款金额，必须 > 0'
  },
  repay_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '还款日期'
  },
  account_id: {
    type: DataTypes.INTEGER,
    comment: '收款账户（还款到账的账户）'
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
  tableName: 'loan_repayments',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false, // 还款记录一旦写入，一般不允许修改（要改就删了重建）
  indexes: [
    { fields: ['loan_id'] },
    { fields: ['repay_date'] },
    { fields: ['account_id'] }
  ]
});

module.exports = LoanRepayment;
