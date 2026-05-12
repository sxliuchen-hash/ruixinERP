/**
 * ============================================================
 * 报销单模型（Expense）
 * ============================================================
 * 对应数据表：expenses
 *
 * 【业务定位】
 *   员工日常费用报销（差旅、招待、办公用品、交通等），生命周期：
 *   草稿/企微同步 → 人工确认 → 出账 → （可选）退回
 *
 *   与 payment(category='fee') 的区别：
 *   - Expense 关注"谁、为了什么事、花了多少钱"的业务维度
 *   - 业务上可追溯到具体员工、可按类别/月度汇总
 *   - 确认出账后对账户余额产生影响（由 accountService 聚合计算）
 *   - 不直接写 payments 表，保持单据独立性（避免双重计账）
 *
 * 【关键字段】
 *   cost_category_id 报销类别（指向 cost_categories 二级分类，如 交通/招待）
 *   account_id       付款账户：confirmed 后才纳入账户余额计算
 *   confirm_status:
 *     - pending   ：企微同步来或草稿，不影响账户余额
 *     - confirmed ：已确认，实时影响账户余额
 *   sp_no：企微审批单号（幂等键，预留 Phase 2 对接）
 *   summary：摘要（关键词自动归类的匹配字段）
 *
 * 【数据隔离】
 *   agent 角色只能看自己 created_by 的记录，由路由 attachDataFilter 处理
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Expense = sequelize.define('Expense', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '报销人（关联主项目 users.id）'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '报销金额，必须 > 0'
  },
  cost_category_id: {
    type: DataTypes.INTEGER,
    comment: '报销类别（cost_categories.id），用于按类别统计'
  },
  expense_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '费用发生日期（非出账日期）'
  },
  account_id: {
    type: DataTypes.INTEGER,
    comment: '付款账户，confirmed 后纳入账户余额计算'
  },
  sp_no: {
    type: DataTypes.STRING(50),
    comment: '关联企微审批单号（幂等键，Phase 2 用）'
  },
  confirm_status: {
    type: DataTypes.ENUM('pending', 'confirmed'),
    defaultValue: 'confirmed',
    comment: 'pending=待确认（不影响余额），confirmed=已确认（影响余额）'
  },
  summary: {
    type: DataTypes.STRING(500),
    comment: '摘要（关键词自动归类）'
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
  tableName: 'expenses',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['cost_category_id'] },
    { fields: ['expense_date'] },
    { fields: ['account_id'] },
    { fields: ['sp_no'] },
    { fields: ['confirm_status'] }
  ]
});

module.exports = Expense;
