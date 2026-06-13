const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const BankAccount = require('../models/BankAccount');
const AccountTransfer = require('../models/AccountTransfer');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');

class AccountService {
  /**
   * 获取账户列表（含当前余额）
   */
  async getList(query) {
    const { page, limit, offset } = parsePagination(query);
    const { status, account_type, keyword } = query;

    const where = {};
    if (status !== undefined && status !== '') {
      where.status = parseInt(status, 10);
    }
    if (account_type) {
      where.account_type = account_type;
    }
    if (keyword) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { bank_name: { [Op.like]: `%${keyword}%` } },
        { account_no: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await BankAccount.findAndCountAll({
      where,
      order: [['create_time', 'DESC']],
      offset,
      limit
    });

    // 计算每个账户的当前余额
    const accountsWithBalance = await Promise.all(
      data.rows.map(async (account) => {
        const balance = await this.calculateBalance(account.id, account.initial_balance);
        return {
          ...account.toJSON(),
          current_balance: balance
        };
      })
    );

    return {
      list: accountsWithBalance,
      pagination: {
        page,
        limit,
        total: data.count,
        totalPages: Math.ceil(data.count / limit)
      }
    };
  }

  /**
   * 计算账户当前余额
   *
   * 余额 = 期初余额
   *       + 收入(income payments)
   *       - 支出(expense payments)
   *       + 转入(account_transfers.to_account)
   *       - 转出(account_transfers.from_account)
   *       - 报销支出(expenses confirmed)      ← T12 新增
   *       - 借款支出(loans 所有单据)           ← T12 新增
   *       + 还款收入(loan_repayments)          ← T12 新增
   *
   * 注意：
   *   - 报销仅统计 confirmed（pending 不影响余额）
   *   - 借款一旦录入即计入支出（无 confirm_status 机制）
   *   - 还款每笔均计入收入
   */
  async calculateBalance(accountId, initialBalance = 0, transaction = null) {
    // 用并列子查询一次性聚合全部资金流，避免逐项 N 次数据库往返；
    // 传入 transaction 时在同一事务内读取（供转账余额校验等并发安全场景使用）
    const [row] = await sequelize.query(
      `SELECT
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE account_id = :id AND type = 'income') AS income,
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE account_id = :id AND type = 'expense') AS expense,
         (SELECT COALESCE(SUM(amount), 0) FROM account_transfers WHERE to_account_id = :id) AS transfer_in,
         (SELECT COALESCE(SUM(amount), 0) FROM account_transfers WHERE from_account_id = :id) AS transfer_out,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE account_id = :id AND confirm_status = 'confirmed') AS reimburse,
         (SELECT COALESCE(SUM(amount), 0) FROM loans WHERE account_id = :id) AS loan_out,
         (SELECT COALESCE(SUM(amount), 0) FROM loan_repayments WHERE account_id = :id) AS loan_in`,
      { replacements: { id: accountId }, type: QueryTypes.SELECT, transaction }
    );

    const income = parseFloat(row.income) || 0;
    const expense = parseFloat(row.expense) || 0;
    const transferIn = parseFloat(row.transfer_in) || 0;
    const transferOut = parseFloat(row.transfer_out) || 0;
    const reimburse = parseFloat(row.reimburse) || 0;
    const loanOut = parseFloat(row.loan_out) || 0;
    const loanIn = parseFloat(row.loan_in) || 0;
    const initial = parseFloat(initialBalance) || 0;

    const balance = initial
      + income - expense
      + transferIn - transferOut
      - reimburse
      - loanOut + loanIn;

    return parseFloat(balance.toFixed(2));
  }

  /**
   * 创建账户
   */
  async create(data, userId) {
    // 检查账号唯一性
    if (data.account_no) {
      const existing = await BankAccount.findOne({ where: { account_no: data.account_no } });
      if (existing) {
        throw new ValidationError('该账号已存在');
      }
    }

    const account = await BankAccount.create({
      ...data,
      created_by: userId
    });

    return account;
  }

  /**
   * 编辑账户
   */
  async update(id, data) {
    const account = await BankAccount.findByPk(id);
    if (!account) {
      throw new NotFoundError('账户不存在');
    }

    // 如果修改了账号，检查唯一性
    if (data.account_no && data.account_no !== account.account_no) {
      const existing = await BankAccount.findOne({ where: { account_no: data.account_no } });
      if (existing) {
        throw new ValidationError('该账号已存在');
      }
    }

    await account.update(data);
    return account;
  }

  /**
   * 设置期初余额
   */
  async setInitialBalance(id, initialBalance) {
    const account = await BankAccount.findByPk(id);
    if (!account) {
      throw new NotFoundError('账户不存在');
    }

    await account.update({ initial_balance: initialBalance });

    const currentBalance = await this.calculateBalance(id, initialBalance);

    return {
      ...account.toJSON(),
      initial_balance: initialBalance,
      current_balance: currentBalance
    };
  }

  /**
   * 获取账户流水明细
   *
   * 统一流水 = payments + account_transfers(双向) + expenses(confirmed)
   *           + loans(支出) + loan_repayments(收入)
   *
   * 注意：
   *   - expenses 仅展示 confirmed 的记录（pending 不纳入余额计算）
   *   - 各来源用 source_type 字段区分，前端据此渲染图标/跳转
   *   - 排序按 flow_date DESC, create_time DESC
   */
  async getFlow(accountId, query) {
    const account = await BankAccount.findByPk(accountId);
    if (!account) {
      throw new NotFoundError('账户不存在');
    }

    const { page, limit, offset } = parsePagination(query);
    const { start_date, end_date } = query;

    // 各来源的日期过滤片段（预先构造，防止下方 SQL 拼接混乱）
    const dateFilter = {
      payment:   '',
      transfer:  '',
      expense:   '',
      loan:      '',
      repayment: ''
    };
    const dateReps = []; // 日期占位的 ? 参数顺序

    if (start_date) {
      dateFilter.payment   += ' AND payment_date >= ?';
      dateFilter.transfer  += ' AND transfer_date >= ?';
      dateFilter.expense   += ' AND expense_date >= ?';
      dateFilter.loan      += ' AND loan_date >= ?';
      dateFilter.repayment += ' AND repay_date >= ?';
    }
    if (end_date) {
      dateFilter.payment   += ' AND payment_date <= ?';
      dateFilter.transfer  += ' AND transfer_date <= ?';
      dateFilter.expense   += ' AND expense_date <= ?';
      dateFilter.loan      += ' AND loan_date <= ?';
      dateFilter.repayment += ' AND repay_date <= ?';
    }

    // 将日期参数以每个来源各推两次的方式组装（count 和 list 查询相同顺序）
    const pushDateReps = (reps) => {
      // 顺序：payment, transfer_out, transfer_in, expense, loan, repayment
      // 每个来源按存在的日期过滤各推一次
      [5].forEach(() => {}); // 占位：注释用
      if (start_date) reps.push(start_date);
      if (end_date) reps.push(end_date);
    };

    // 为 count 构造 replacements
    const countReps = [accountId];
    pushDateReps(countReps);
    countReps.push(accountId);
    pushDateReps(countReps);
    countReps.push(accountId);
    pushDateReps(countReps);
    countReps.push(accountId);
    pushDateReps(countReps);
    countReps.push(accountId);
    pushDateReps(countReps);
    countReps.push(accountId);
    pushDateReps(countReps);

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT id FROM payments WHERE account_id = ? ${dateFilter.payment}
        UNION ALL
        SELECT id FROM account_transfers WHERE from_account_id = ? ${dateFilter.transfer}
        UNION ALL
        SELECT id FROM account_transfers WHERE to_account_id = ? ${dateFilter.transfer}
        UNION ALL
        SELECT id FROM expenses WHERE account_id = ? AND confirm_status = 'confirmed' ${dateFilter.expense}
        UNION ALL
        SELECT id FROM loans WHERE account_id = ? ${dateFilter.loan}
        UNION ALL
        SELECT id FROM loan_repayments WHERE account_id = ? ${dateFilter.repayment}
      ) AS combined
    `;
    const [countResult] = await sequelize.query(countSql, {
      replacements: countReps,
      type: QueryTypes.SELECT
    });
    const total = countResult.total;

    // 为 list 构造 replacements（同 count 顺序 + 末尾 limit/offset）
    const listReps = [accountId];
    pushDateReps(listReps);
    listReps.push(accountId);
    pushDateReps(listReps);
    listReps.push(accountId);
    pushDateReps(listReps);
    listReps.push(accountId);
    pushDateReps(listReps);
    listReps.push(accountId);
    pushDateReps(listReps);
    listReps.push(accountId);
    pushDateReps(listReps);
    listReps.push(limit, offset);

    const flowSql = `
      SELECT * FROM (
        SELECT
          p.id,
          'payment' AS source_type,
          p.type AS flow_type,
          p.amount,
          p.payment_date AS flow_date,
          p.summary,
          p.remark,
          p.create_time
        FROM payments p
        WHERE p.account_id = ? ${dateFilter.payment.replace(/payment_date/g, 'p.payment_date')}

        UNION ALL

        SELECT
          t.id,
          'transfer_out' AS source_type,
          'expense' AS flow_type,
          t.amount,
          t.transfer_date AS flow_date,
          CONCAT('转出至账户ID:', t.to_account_id) AS summary,
          t.remark,
          t.create_time
        FROM account_transfers t
        WHERE t.from_account_id = ? ${dateFilter.transfer.replace(/transfer_date/g, 't.transfer_date')}

        UNION ALL

        SELECT
          t.id,
          'transfer_in' AS source_type,
          'income' AS flow_type,
          t.amount,
          t.transfer_date AS flow_date,
          CONCAT('从账户ID:', t.from_account_id, '转入') AS summary,
          t.remark,
          t.create_time
        FROM account_transfers t
        WHERE t.to_account_id = ? ${dateFilter.transfer.replace(/transfer_date/g, 't.transfer_date')}

        UNION ALL

        SELECT
          e.id,
          'expense' AS source_type,
          'expense' AS flow_type,
          e.amount,
          e.expense_date AS flow_date,
          e.summary,
          e.remark,
          e.create_time
        FROM expenses e
        WHERE e.account_id = ? AND e.confirm_status = 'confirmed'
          ${dateFilter.expense.replace(/expense_date/g, 'e.expense_date')}

        UNION ALL

        SELECT
          l.id,
          'loan' AS source_type,
          'expense' AS flow_type,
          l.amount,
          l.loan_date AS flow_date,
          CONCAT('借款：', COALESCE(l.purpose, '')) AS summary,
          l.remark,
          l.create_time
        FROM loans l
        WHERE l.account_id = ?
          ${dateFilter.loan.replace(/loan_date/g, 'l.loan_date')}

        UNION ALL

        SELECT
          r.id,
          'loan_repayment' AS source_type,
          'income' AS flow_type,
          r.amount,
          r.repay_date AS flow_date,
          CONCAT('还款（借款ID:', r.loan_id, '）') AS summary,
          r.remark,
          r.create_time
        FROM loan_repayments r
        WHERE r.account_id = ?
          ${dateFilter.repayment.replace(/repay_date/g, 'r.repay_date')}
      ) AS flow
      ORDER BY flow_date DESC, create_time DESC
      LIMIT ? OFFSET ?
    `;

    const flows = await sequelize.query(flowSql, {
      replacements: listReps,
      type: QueryTypes.SELECT
    });

    const currentBalance = await this.calculateBalance(accountId, account.initial_balance);

    return {
      account: {
        ...account.toJSON(),
        current_balance: currentBalance
      },
      list: flows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 账户间转账
   */
  async transfer(data, userId) {
    const { from_account_id, to_account_id, amount, transfer_date, remark } = data;

    if (from_account_id === to_account_id) {
      throw new ValidationError('转出账户和转入账户不能相同');
    }

    if (!amount || amount <= 0) {
      throw new ValidationError('转账金额必须大于0');
    }

    // 验证两个账户都存在且启用
    const fromAccount = await BankAccount.findByPk(from_account_id);
    if (!fromAccount) {
      throw new NotFoundError('转出账户不存在');
    }
    if (fromAccount.status !== 1) {
      throw new ValidationError('转出账户已停用');
    }

    const toAccount = await BankAccount.findByPk(to_account_id);
    if (!toAccount) {
      throw new NotFoundError('转入账户不存在');
    }
    if (toAccount.status !== 1) {
      throw new ValidationError('转入账户已停用');
    }

    // 检查转出账户余额是否充足
    const fromBalance = await this.calculateBalance(from_account_id, fromAccount.initial_balance);
    if (fromBalance < amount) {
      throw new ValidationError(`转出账户余额不足，当前余额: ${fromBalance}`);
    }

    // 创建转账记录
    const transfer = await AccountTransfer.create({
      from_account_id,
      to_account_id,
      amount,
      transfer_date: transfer_date || new Date(),
      remark,
      created_by: userId
    });

    return transfer;
  }
}

module.exports = new AccountService();
