/**
 * ============================================================
 * 成本分类模型（CostCategory）
 * ============================================================
 * 对应数据表：cost_categories（SQL 已有预置数据，见 init-database.sql）
 *
 * 【层级结构】
 *   支持二级分类：parent_id=NULL 为顶层大类（人力/运营/专利/营销/其他），
 *   二级为具体子类（工资/房租等）。
 *
 * 【type 枚举】
 *   labor       ：人力成本（工资/社保/公积金）
 *   operation   ：运营成本（房租/水电/网络/物业/办公用品）
 *   patent      ：专利维持（年费/代理费）
 *   marketing   ：营销成本（推广/获客）
 *   other       ：其他
 *
 * 【业务用途】
 *   - Payment（费用类）选择类别
 *   - CostRecord 关联类别做分类汇总
 *   - Dashboard 的 cost-breakdown 按 type 聚合作为饼图数据源
 *
 * 【不接受删除级联】
 *   删除类别时不自动删除关联的 payments/cost_records。
 *   类别应长期稳定，删除前 service 层会校验引用计数。
 * ============================================================
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CostCategory = sequelize.define('CostCategory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '类别名称'
  },
  parent_id: {
    type: DataTypes.INTEGER,
    comment: '父类别（支持二级分类）'
  },
  type: {
    type: DataTypes.ENUM('labor', 'operation', 'patent', 'marketing', 'other'),
    allowNull: false,
    comment: '大类'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '排序'
  },
  status: {
    type: DataTypes.TINYINT,
    defaultValue: 1,
    comment: '1启用/0停用'
  }
}, {
  tableName: 'cost_categories',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    { fields: ['parent_id'] },
    { fields: ['type'] },
    { fields: ['status'] }
  ]
});

module.exports = CostCategory;
