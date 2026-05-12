const { DataTypes } = require('sequelize');
const { mainSequelize } = require('../config/mainDatabase');

/**
 * 主项目 User 模型（只读）
 * 绑定到 patent_notice_system 的 users 表
 */
const MainUser = mainSequelize.define('MainUser', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  realName: {
    type: DataTypes.STRING(50),
    field: 'real_name'
  },
  email: {
    type: DataTypes.STRING(100)
  },
  phone: {
    type: DataTypes.STRING(20)
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'client'
  },
  status: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: '1=启用, 0=禁用'
  },
  departmentName: {
    type: DataTypes.STRING(100),
    field: 'department_name'
  },
  wxOpenid: {
    type: DataTypes.STRING(64),
    field: 'wx_openid'
  },
  wxUnionid: {
    type: DataTypes.STRING(64),
    field: 'wx_unionid'
  },
  wxNickname: {
    type: DataTypes.STRING(100),
    field: 'wx_nickname'
  },
  userLevel: {
    type: DataTypes.INTEGER,
    field: 'user_level',
    defaultValue: 1
  },
  parentId: {
    type: DataTypes.INTEGER,
    field: 'parent_id'
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
  defaultScope: {
    attributes: { exclude: ['password'] }
  },
  scopes: {
    withPassword: {
      attributes: {}
    }
  }
});

module.exports = MainUser;
