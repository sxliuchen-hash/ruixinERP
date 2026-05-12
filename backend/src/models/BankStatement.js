/**
 * ============================================================
 * 银行流水模型（BankStatement）
 * ============================================================
 * 对应数据表：bank_statements
 *
 * 【业务定位】
 *   用户从网银/第三方工具导出 Excel 流水后，通过"银行对账"页上传，
 *   系统逐条解析存入本表，然后与 payments 表做匹配对账。
 *
 * 【关键字段】
 *   batch_no            上传批次号（同一次上传的所有流水共用，UUID 简化版）
 *   trans_date          交易日期
 *   amount              金额（正数收入、负数支出，保持原始银行语义）
 *   balance             交易后余额（若银行导出有）
 *   summary             摘要/用途
 *   counterparty        对方户名
 *   match_status:
 *     - unmatched ：流水有但系统无匹配 payment
 *     - matched   ：已与 payment 建立关联
 *     - extra     ：系统有但流水无（由对账算法反向生成的占位条目，很少使用）
 *     - ignored   ：手动忽略（跨行转账、个人消费等）
 *   matched_payment_id  匹配到的 payments.id
 *   suggested_category_id 建议的成本类别（T13 自动归类建议）
 *
 * 【索引】
 *   按 batch_no 聚合查询一次对账结果；按 match_status 筛选
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BankStatement = sequelize.define('BankStatement', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  account_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '对账账户 ID'
  },
  batch_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '导入批次号'
  },
  trans_date: {
    type: DataTypes.DATEONLY,
    comment: '交易日期'
  },
  amount: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    comment: '金额（正数收入、负数支出）'
  },
  balance: {
    type: DataTypes.DECIMAL(14, 2),
    comment: '交易后余额'
  },
  summary: {
    type: DataTypes.STRING(500),
    comment: '摘要/用途'
  },
  counterparty: {
    type: DataTypes.STRING(200),
    comment: '对方户名'
  },
  match_status: {
    type: DataTypes.ENUM('unmatched', 'matched', 'extra', 'ignored'),
    defaultValue: 'unmatched',
    comment: '匹配状态'
  },
  matched_payment_id: {
    type: DataTypes.INTEGER,
    comment: '匹配到的 payments.id'
  },
  match_score: {
    type: DataTypes.DECIMAL(4, 2),
    comment: '匹配置信度（0-100）'
  },
  suggested_category_id: {
    type: DataTypes.INTEGER,
    comment: '建议的成本类别'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '上传人'
  }
}, {
  tableName: 'bank_statements',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['account_id'] },
    { fields: ['batch_no'] },
    { fields: ['match_status'] },
    { fields: ['trans_date'] },
    { fields: ['matched_payment_id'] }
  ]
});

module.exports = BankStatement;
