/**
 * ============================================================
 * 员工档案模型（Employee）
 * ============================================================
 * 记录公司员工的基本信息、薪资结构、职级等。
 * 关联主项目 users 表（通过 user_id），用于业绩归属匹配。
 *
 * 角色类型：
 *   - partner: 合伙人（罗正武，业务毛利×70%）
 *   - sales: 销售顾问（提成+职级津贴）
 *   - purchase: 采购（专利卖出提成）
 *   - admin: 内勤（固定奖金）
 *   - boss: 老板（刘晨，单独统计）
 * ============================================================
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '关联主项目 users.id'
  },
  wechat_userid: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '企微 userid（用于审批归属匹配）'
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '姓名'
  },
  role: {
    type: DataTypes.ENUM('boss', 'partner', 'sales', 'purchase', 'admin'),
    allowNull: false,
    comment: '角色类型'
  },
  status: {
    type: DataTypes.ENUM('probation', 'regular', 'resigned'),
    defaultValue: 'probation',
    comment: '状态：试用/正式/离职'
  },
  grade: {
    type: DataTypes.ENUM('A', 'B', 'C', 'D', 'E'),
    defaultValue: 'A',
    comment: '当前职级（仅销售适用）'
  },
  region: {
    type: DataTypes.STRING(20),
    defaultValue: '西安',
    comment: '所在区域'
  },
  hire_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: '入职日期'
  },
  regular_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: '转正日期'
  },
  resign_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: '离职日期'
  },
  base_salary: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 2400,
    comment: '基本工资'
  },
  position_allowance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 1000,
    comment: '岗位补贴'
  },
  attendance_bonus: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 100,
    comment: '全勤奖'
  },
  social_insurance_base: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 2120,
    comment: '社保基数（西安最低工资）'
  },
  social_insurance_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.153,
    comment: '个人社保缴纳比例（养老8%+医疗2%+失业0.3%+公积金5%）'
  },
  partner_share_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0,
    comment: '合伙人分成比例（如0.7表示70%）'
  },
  remark: {
    type: DataTypes.TEXT,
    comment: '备注'
  }
}, {
  tableName: 'employees',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time'
});

module.exports = Employee;
