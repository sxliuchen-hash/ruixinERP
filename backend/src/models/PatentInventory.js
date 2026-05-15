/**
 * ============================================================
 * 专利库存模型（PatentInventory）
 * ============================================================
 * 对应数据表：patent_inventory
 *
 * 【业务定位】
 *   囤积专利的完整生命周期管理：入库 → 持有（年费维持）→ 售出/放弃。
 *   一个专利号（patent_no）一条记录，unique 约束避免重复录入。
 *
 * 【关键字段说明】
 *   patent_no           ：专利号，唯一标识
 *   purchase_price      ：采购成本（固定，不随调价变化）
 *   current_price       ：当前售价（通过调价接口更新，旧值保留到 price_history）
 *   total_maintain_cost ：累计维持成本（冗余字段，由 annual_fees 聚合后写入）
 *   next_fee_deadline   ：下次年费到期日（手工维护或由 annual_fee 最近一条更新）
 *   status:
 *     - in_stock      ：在库（可用于调价、添加年费、售出）
 *     - sold          ：已售（stock_out_date 记录出库日）
 *     - abandoned     ：放弃（不再维持，余额冻结）
 *     - transferring  ：转让中（签订中的过渡状态）
 *
 * 【派生字段（非表字段，在 service 层计算）】
 *   stock_age_days = DATEDIFF(NOW(), stock_in_date)   库龄（天）
 *   estimate_profit = current_price - purchase_price - total_maintain_cost  利润预估
 *
 * 【关联关系】
 *   supplier_id → suppliers.id
 *   contract_id → contracts.id（采购合同）
 *   project_id  → projects.id（T16 创建）
 *
 * 【数据隔离】
 *   agent 只能看自己 created_by 的记录
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PatentInventory = sequelize.define('PatentInventory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  patent_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '专利号，唯一'
  },
  patent_name: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '专利名称'
  },
  patent_type: {
    type: DataTypes.STRING(20),
    comment: '专利类型（发明/实用新型/外观）'
  },
  tech_field: {
    type: DataTypes.STRING(100),
    comment: '技术领域'
  },
  purchase_price: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '采购价格（成本，固定不变）'
  },
  purchase_date: {
    type: DataTypes.DATEONLY,
    comment: '采购日期'
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    comment: '供应商 ID'
  },
  contract_id: {
    type: DataTypes.INTEGER,
    comment: '关联采购合同 ID'
  },
  project_id: {
    type: DataTypes.INTEGER,
    comment: '关联交易项目 ID（T16）'
  },
  status: {
    type: DataTypes.ENUM('in_stock', 'sold', 'abandoned', 'transferring'),
    defaultValue: 'in_stock',
    comment: '库存状态'
  },
  current_price: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '当前售价（通过调价接口维护）'
  },
  total_maintain_cost: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '累计维持成本（聚合冗余，勿直接修改）'
  },
  next_fee_deadline: {
    type: DataTypes.DATEONLY,
    comment: '下次年费到期日（用于到期提醒）'
  },
  stock_in_date: {
    type: DataTypes.DATEONLY,
    comment: '入库日期（库龄计算起点）'
  },
  stock_out_date: {
    type: DataTypes.DATEONLY,
    comment: '出库日期（status=sold 时记录）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  reported_high_tech: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否报过高企'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '创建人（agent 数据隔离依据）'
  }
}, {
  tableName: 'patent_inventory',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['patent_no'], unique: true },
    { fields: ['status'] },
    { fields: ['supplier_id'] },
    { fields: ['project_id'] },
    { fields: ['next_fee_deadline'] },
    { fields: ['tech_field'] }
  ]
});

module.exports = PatentInventory;
