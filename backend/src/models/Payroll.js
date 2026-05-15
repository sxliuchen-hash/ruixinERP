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
  leave_days: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
    comment: '请假天数'
  },
  leave_deduction: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '请假扣款'
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
    type: DataTypes.ENUM('draft', 'confirmed', 'paid'),
    defaultValue: 'draft',
    comment: '状态：草稿/已确认/已发放'
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
    { unique: true, fields: ['employee_id', 'year', 'month'] }
  ]
});

module.exports = Payroll;
