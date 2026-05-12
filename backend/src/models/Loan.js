/**
 * ============================================================
 * 借款单模型（Loan）
 * ============================================================
 * 对应数据表：loans
 *
 * 【业务定位】
 *   员工向公司借款（备用金、差旅预支等），通过分次还款完成核销。
 *
 * 【关键字段】
 *   amount         ：借款金额（固定，不变更）
 *   repaid_amount  ：已还款累计（冗余字段，由 LoanRepayment 新增/删除时
 *                    事务内重新聚合后写入，避免实时 SUM 性能压力）
 *   status         ：自动维护，规则：
 *                    - repaid_amount == 0             → 'unpaid'
 *                    - 0 < repaid_amount < amount    → 'partial'
 *                    - repaid_amount >= amount        → 'paid'
 *   account_id     ：借款时的付款账户，影响账户余额（计入支出）
 *
 * 【账户余额联动】
 *   借款发生 → from account 扣减（calculateBalance 聚合）
 *   还款到账 → to account（还款记录的 account_id）增加（calculateBalance 聚合）
 *   余额计算扩展到 accountService 中完成，模型本身只维护单据数据
 *
 * 【数据隔离】
 *   agent 角色只能看自己 created_by 的记录
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Loan = sequelize.define('Loan', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '借款人（关联主项目 users.id）'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '借款金额，必须 > 0'
  },
  repaid_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '已还金额（由 LoanRepayment 聚合维护，勿直接修改）'
  },
  loan_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '借款发生日期'
  },
  purpose: {
    type: DataTypes.STRING(500),
    comment: '借款用途'
  },
  status: {
    type: DataTypes.ENUM('unpaid', 'partial', 'paid'),
    defaultValue: 'unpaid',
    comment: '还款状态（自动维护，不可手动修改）'
  },
  account_id: {
    type: DataTypes.INTEGER,
    comment: '付款账户（借款时扣减该账户余额）'
  },
  sp_no: {
    type: DataTypes.STRING(50),
    comment: '关联企微审批单号（Phase 2）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人（agent 数据隔离依据）'
  }
}, {
  tableName: 'loans',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['loan_date'] },
    { fields: ['account_id'] },
    { fields: ['sp_no'] }
  ]
});

module.exports = Loan;
