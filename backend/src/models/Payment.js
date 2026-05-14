/**
 * ============================================================
 * 收付款模型（Payment）
 * ============================================================
 * 对应数据表：payments
 *
 * 【两个维度组合出四种记录】
 *   type=income  + category=business → 销售合同回款
 *   type=income  + category=fee      → 其他收入（利息、退款等）
 *   type=expense + category=business → 采购合同付款
 *   type=expense + category=fee      → 费用支出（报销、房租、工资等）
 *
 * 【关键字段说明】
 *   confirm_status:
 *     - confirmed：人工录入的记录默认已确认，实时影响合同 paid_amount
 *     - pending  ：企微审批同步来的记录，需人工确认后才影响合同
 *   sp_no：企微审批单号，审批同步时用作幂等键（unique 索引）
 *   summary：摘要，用于自动归类（classifyService）的关键词匹配
 *
 * 【关联关系】
 *   - account_id      → bank_accounts.id（必填）
 *   - contract_id     → contracts.id（business 必填，fee 留空）
 *   - customer_id     → customers.id（收款时）
 *   - supplier_id     → suppliers.id（付款时）
 *   - cost_category_id → cost_categories.id（fee 时填）
 *   - project_id      → projects.id（Phase 3）
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.ENUM('income', 'expense'),
    allowNull: false,
    comment: '收款/付款'
  },
  category: {
    type: DataTypes.ENUM('business', 'fee'),
    allowNull: false,
    defaultValue: 'business',
    comment: '业务类（关联合同）/费用类（关联成本类别）'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '金额，必须 > 0'
  },
  payment_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '收付款日期（银行到账/扣款日）'
  },
  payment_method: {
    type: DataTypes.ENUM('transfer', 'check', 'cash', 'other'),
    defaultValue: 'transfer',
    comment: '支付方式：转账/支票/现金/其他'
  },
  account_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '银行账户ID，必填'
  },
  contract_id: {
    type: DataTypes.INTEGER,
    comment: '关联合同ID（业务类必填）'
  },
  customer_id: {
    type: DataTypes.INTEGER,
    comment: '客户ID（收款时）'
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    comment: '供应商ID（付款时）'
  },
  project_id: {
    type: DataTypes.INTEGER,
    comment: '关联交易项目ID（Phase 3 使用）'
  },
  cost_category_id: {
    type: DataTypes.INTEGER,
    comment: '成本类别ID（费用类使用）'
  },
  sp_no: {
    type: DataTypes.STRING(50),
    comment: '企微审批单号（幂等键）'
  },
  confirm_status: {
    type: DataTypes.ENUM('pending', 'confirmed'),
    defaultValue: 'confirmed',
    comment: 'pending=企微同步待确认，confirmed=已确认（影响合同paid_amount）'
  },
  summary: {
    type: DataTypes.STRING(500),
    comment: '摘要（自动归类匹配关键词的字段）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人（agent 数据隔离依据）'
  },
  applyer_name: {
    type: DataTypes.STRING(50),
    comment: '审批申请人姓名'
  },
  payment_no: {
    type: DataTypes.STRING(50),
    comment: '付款编号'
  }
}, {
  tableName: 'payments',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['contract_id'] },       // 合同详情页聚合
    { fields: ['account_id'] },        // 账户流水聚合
    { fields: ['project_id'] },        // 项目利润聚合
    { fields: ['payment_date'] },      // 趋势图按日期查询
    { fields: ['sp_no'] },             // 审批同步幂等查询
    { fields: ['confirm_status'] }     // 待确认筛选
  ]
});

module.exports = Payment;
