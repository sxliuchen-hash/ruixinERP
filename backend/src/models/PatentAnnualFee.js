/**
 * ============================================================
 * 专利年费/维持成本模型（PatentAnnualFee）
 * ============================================================
 * 对应数据表：patent_annual_fees
 *
 * 【业务定位】
 *   专利持有期间发生的各类维持费用记录：
 *   - annual ：年费（主要）
 *   - agency ：代理费
 *   - other  ：其他维持费
 *
 * 【级联影响】
 *   1) 新增/删除一条记录时，事务内重算所属 patent_inventory 的：
 *      - total_maintain_cost（累计维持成本）
 *      - next_fee_deadline（取最晚的 deadline_date 作为下次到期日）
 *   2) 可关联 payment_id 指向一笔真实的付款记录（可选，便于对账）
 *
 * 【到期提醒】
 *   deadline_date 即"缴费后能维持到的截止日"，
 *   inventoryService.getExpiring 会基于每个专利最新的 deadline_date 判断是否临近到期。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PatentAnnualFee = sequelize.define('PatentAnnualFee', {
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
  fee_type: {
    type: DataTypes.ENUM('annual', 'agency', 'other'),
    defaultValue: 'annual',
    comment: '费用类型：年费/代理费/其他'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '金额'
  },
  fee_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '缴费日期'
  },
  deadline_date: {
    type: DataTypes.DATEONLY,
    comment: '本次缴费能维持到的到期日'
  },
  payment_id: {
    type: DataTypes.INTEGER,
    comment: '关联 payments.id（可选）'
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
  tableName: 'patent_annual_fees',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: false,
  indexes: [
    { fields: ['inventory_id'] },
    { fields: ['fee_date'] },
    { fields: ['deadline_date'] },
    { fields: ['payment_id'] }
  ]
});

module.exports = PatentAnnualFee;
