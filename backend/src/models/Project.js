/**
 * ============================================================
 * 交易项目模型（Project）
 * ============================================================
 * 对应数据表：projects
 *
 * 【业务定位】
 *   一个"交易项目"代表一笔完整的专利买卖业务：
 *     采购专利（采购合同 + 付款）→ 持有期间维持（年费）→ 对外出售（销售合同 + 收款）
 *   Project 是这整条链路的核算单元，能独立计算毛利润。
 *
 * 【聚合字段（冗余）】
 *   以下字段由 projectService.refreshAggregates 从关联数据聚合写入，
 *   避免每次查询利润时都跑多表 JOIN，提升列表性能。
 *
 *   sale_amount     ：关联销售合同的 amount 之和
 *   purchase_amount ：关联采购合同的 amount 之和
 *   tax_cost        ：采购税点成本 = sum(purchase.amount × supplier.tax_rate / 100)
 *   maintain_cost   ：维持成本 = sum(patent_annual_fees.amount)
 *                     其中 patent_annual_fees 关联的 inventory.project_id = 本项目
 *   gross_profit    ：sale_amount - purchase_amount - tax_cost - maintain_cost
 *
 * 【触发时机】
 *   - 创建/编辑项目 → 立即聚合一次
 *   - 显式调用 POST /projects/:id/refresh → 重新聚合
 *   - 合同/收付款/年费的 CRUD 不主动触发（降低耦合），依赖定时任务或手动刷新
 *
 * 【状态机】
 *   active      ：进行中（允许添加关联）
 *   completed   ：已完成（所有关联销售合同均 completed 时自动流转）
 *   cancelled   ：已取消（手动标记）
 *
 * 【数据隔离】
 *   agent 角色只能看 created_by=自己 或 owner_id=自己 的项目（OR 条件）。
 *   兼顾"我创建的"和"分配给我的"两种业务场景。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Project = sequelize.define('Project', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '项目名称'
  },
  patent_no: {
    type: DataTypes.STRING(50),
    comment: '关联专利号（便于索引，项目-专利为 1:N 时取主专利）'
  },
  customer_id: {
    type: DataTypes.INTEGER,
    comment: '客户 ID（销售方）'
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    comment: '供应商 ID（采购方）'
  },
  status: {
    type: DataTypes.ENUM('active', 'completed', 'cancelled'),
    defaultValue: 'active',
    comment: '项目状态'
  },
  sale_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '销售收入（聚合冗余）'
  },
  purchase_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '采购成本（聚合冗余）'
  },
  tax_cost: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '采购税点成本（聚合冗余）'
  },
  maintain_cost: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '维持成本（聚合冗余）'
  },
  gross_profit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '毛利润 = 销售收入 - 采购 - 税点 - 维持（冗余）'
  },
  owner_id: {
    type: DataTypes.INTEGER,
    comment: '负责人（数据隔离依据之一）'
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
  tableName: 'projects',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['status'] },
    { fields: ['customer_id'] },
    { fields: ['supplier_id'] },
    { fields: ['owner_id'] },
    { fields: ['patent_no'] }
  ]
});

module.exports = Project;
