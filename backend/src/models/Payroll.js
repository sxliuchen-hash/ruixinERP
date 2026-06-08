/**
 * ============================================================
 * 工资条模型（Payroll）
 * ============================================================
 * 记录每月每人的工资明细，包含：
 *   - 基础薪资（基本工资+岗位补贴+全勤奖）
 *   - 职级津贴
 *   - 业务提成（销售/采购）
 *   - 奖金（手动填写）
 *   - 社保扣除
 *   - 请假扣款
 *   - 其他扣款
 *   - 实发合计
 *
 * 状态流转：draft → confirmed → paid
 * ============================================================
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Payroll = sequelize.define('Payroll', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '员工ID'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '年份'
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '月份(1-12)'
  },
  // ===== 收入项 =====
  base_salary: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '基本工资'
  },
  position_allowance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '岗位补贴'
  },
  attendance_bonus: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '全勤奖（有请假则为0）'
  },
  grade_allowance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '职级津贴'
  },
  commission: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '业务提成（销售超额累进/采购专利卖出）'
  },
  purchase_commission: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '采购提成（采购人员卖出自营专利）'
  },
  bonus: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '奖金（手动填写）'
  },
  // ===== 扣除项 =====
  social_insurance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '社保公积金扣除（个人部分）'
  },
  income_tax: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '个人所得税（简化版按月计税）'
  },
  leave_days: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
    comment: '请假天数（事假+病假合计，兼容旧字段）'
  },
  personal_leave_days: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
    comment: '事假天数'
  },
  sick_leave_days: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
    comment: '病假天数'
  },
  leave_deduction: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '请假扣款（事假+病假合计）'
  },
  other_deduction: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '其他扣款（手动填写）'
  },
  // ===== 汇总 =====
  gross_income: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '应发合计（所有收入项之和）'
  },
  total_deduction: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '扣除合计'
  },
  net_salary: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '实发合计'
  },
  // ===== 业绩数据（冗余存储，便于追溯） =====
  monthly_profit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '当月业绩毛利（用于计算提成的基数）'
  },
  contract_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '当月签约数'
  },
  // ===== 状态 =====
  status: {
    type: DataTypes.ENUM('draft', 'confirmed', 'paid', 'voided'),
    defaultValue: 'draft',
    comment: '状态：草稿/已确认/已发放/已作废'
  },
  is_adjustment: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否为调整项工资条（补发/补扣）'
  },
  adjust_source_id: {
    type: DataTypes.INTEGER,
    comment: '调整项关联的原工资条 ID'
  },
  voided_reason: {
    type: DataTypes.STRING(255),
    comment: '作废原因'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  },
  confirmed_by: {
    type: DataTypes.INTEGER,
    comment: '确认人'
  },
  confirmed_at: {
    type: DataTypes.DATE,
    comment: '确认时间'
  }
}, {
  tableName: 'payrolls',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  indexes: [
    // 注：不再用唯一索引（调整项允许同员工同月多条）；
    // 主工资条(is_adjustment=false)的唯一性由 service 层保证
    { fields: ['employee_id', 'year', 'month'] },
    { fields: ['status'] }
  ]
});

module.exports = Payroll;
