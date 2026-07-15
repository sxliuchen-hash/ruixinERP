'use strict';

const employeeProvisioningService = require('../services/employeeProvisioningService');

async function provisionEmployee(req, res, next) {
  try {
    const { employee, created } = await employeeProvisioningService.provision({
      ...req.body,
      idempotencyKey: req.idempotencyKey
    });
    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? 'Employee 建档成功' : 'Employee 绑定已同步',
      data: {
        employee: {
          id: Number(employee.id),
          userId: Number(employee.user_id)
        },
        created
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  provisionEmployee
};
