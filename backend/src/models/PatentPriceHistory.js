/**
 * ============================================================
 * 专利调价历史模型（PatentPriceHistory）
 * ============================================================
 * 对应数据表：patent_price_history
 *
 * 【业务定位】
 *   专利售价调整的审计流水。每次调价：
 *   1) 更新 patent_inventory.current_price
 *   2) 同时写入一条 price_history（old_price → new_price）
 *   事务内保证两者一致。
 *
 * 【一次性创建】
 *   调价历史只新增不修改（updatedAt=false），
 *   数据修正需要通过反向调价（再调回去）留痕而非直接删改。
 *
 * 【批量调价】
 *   inventoryService.batchChangePrice 支持按 tech_field / 固定比例等批量调价，
 *   每个专利各生成一条 history 记录。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PatentPriceHistory = sequelize.define('PatentPriceHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  inventory_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联 patent_inventory.id'
  },
  old_price: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '调价前价格'
  },
  new_price: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '调价后价格'
  },
  change_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '调价日期'
  },
  reason: {
    type: DataTypes.STRING(500),
    comment: '调价原因'
  },
  created_by: {
    type: DataTypes.INTEGER,
    comment: '操作人'
  }
}, {
  tableName: 'patent_price_history',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false,
  indexes: [
    { fields: ['inventory_id'] },
    { fields: ['change_date'] }
  ]
});

module.exports = PatentPriceHistory;
