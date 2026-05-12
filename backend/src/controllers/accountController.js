const accountService = require('../services/accountService');
const { ValidationError } = require('../utils/errors');

/**
 * 获取账户列表
 */
async function getList(req, res, next) {
  try {
    const result = await accountService.getList(req.query);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 创建账户
 */
async function create(req, res, next) {
  try {
    const { name, bank_name, account_no, account_type, initial_balance, remark } = req.body;

    if (!name) {
      throw new ValidationError('账户名称不能为空');
    }
    if (!account_type || !['public', 'private'].includes(account_type)) {
      throw new ValidationError('账户类型必须为 public 或 private');
    }

    const account = await accountService.create(
      { name, bank_name, account_no, account_type, initial_balance, remark },
      req.user.id
    );

    res.status(201).json({
      success: true,
      message: '账户创建成功',
      data: account
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 编辑账户
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, bank_name, account_no, account_type, status, remark } = req.body;

    if (account_type && !['public', 'private'].includes(account_type)) {
      throw new ValidationError('账户类型必须为 public 或 private');
    }

    const account = await accountService.update(id, {
      name, bank_name, account_no, account_type, status, remark
    });

    res.json({
      success: true,
      message: '账户更新成功',
      data: account
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 设置期初余额
 */
async function setBalance(req, res, next) {
  try {
    const { id } = req.params;
    const { initial_balance } = req.body;

    if (initial_balance === undefined || initial_balance === null) {
      throw new ValidationError('期初余额不能为空');
    }

    const result = await accountService.setInitialBalance(id, parseFloat(initial_balance));

    res.json({
      success: true,
      message: '期初余额设置成功',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取账户流水明细
 */
async function getFlow(req, res, next) {
  try {
    const { id } = req.params;
    const result = await accountService.getFlow(id, req.query);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 账户间转账
 */
async function transfer(req, res, next) {
  try {
    const { from_account_id, to_account_id, amount, transfer_date, remark } = req.body;

    if (!from_account_id || !to_account_id) {
      throw new ValidationError('转出账户和转入账户不能为空');
    }
    if (!amount || parseFloat(amount) <= 0) {
      throw new ValidationError('转账金额必须大于0');
    }

    const result = await accountService.transfer(
      { from_account_id, to_account_id, amount: parseFloat(amount), transfer_date, remark },
      req.user.id
    );

    res.status(201).json({
      success: true,
      message: '转账成功',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  create,
  update,
  setBalance,
  getFlow,
  transfer
};
