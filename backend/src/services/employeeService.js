'use strict';

const Employee = require('../models/Employee');
const { AppError } = require('../utils/errors');

function mapEmployeeWriteError(error) {
  if (error?.name === 'SequelizeUniqueConstraintError') {
    return new AppError(
      '该主项目账号已绑定其他员工档案',
      409,
      'EMPLOYEE_USER_ID_CONFLICT'
    );
  }
  return error;
}

class EmployeeService {
  constructor({ model = Employee } = {}) {
    this.model = model;
  }

  async create(data) {
    try {
      return await this.model.create(data);
    } catch (error) {
      throw mapEmployeeWriteError(error);
    }
  }

  async update(employee, data) {
    try {
      await employee.update(data);
      return employee;
    } catch (error) {
      throw mapEmployeeWriteError(error);
    }
  }
}

module.exports = new EmployeeService();
module.exports.EmployeeService = EmployeeService;
module.exports.mapEmployeeWriteError = mapEmployeeWriteError;
