/**
 * ============================================================
 * 借款业务服务（LoanService）
 * ============================================================
 *
 * 【核心难点】
 *   借款与还款的金额联动，必须事务化：
 *   - 新增 repayment → 事务内重算 loan.repaid_amount + loan.status
 *   - 删除 repayment → 同样重算
 *   - 删除 loan     → 级联删除所有 repayments
 *
 * 【状态机】
 *   repaid_amount 变化时自动推导 status：
 *     repaid_amount <= 0         → 'unpaid'
 *     0 < repaid < amount        → 'partial'
 *     repaid >= amount           → 'paid'
 *
 * 【账户余额联动】
 *   - 借款发生：loans.account_id 扣减（由 accountService 聚合）
 *   - 还款到账：loan_repayments.account_id 增加（由 accountService 聚合）
 *   本服务不直接写 payments 或 account 余额，保证单一数据源。
 *
 * 【数据隔离】
 *   agent 只能操作自己创建的借款单；还款操作绑定借款所有权。
 * ============================================================
 */

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const Loan = require('../models/Loan');
const LoanRepayment = require('../models/LoanRepayment');
const BankAccount = require('../models/BankAccount');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

class LoanService {
  /**
   * 获取借款列表（分页 + 筛选）
   *
   * @param {Object} query
   * @param {number} [query.user_id]      借款人
   * @param {string} [query.status]       unpaid/partial/paid
   * @param {number} [query.account_id]   付款账户
   * @param {string} [query.start_date]   借款日期起
   * @param {string} [query.end_date]     借款日期止
   * @param {string} [query.keyword]      关键词（purpose/remark/sp_no）
   */
  async getList(query, userId, userRole) {
    const { page, limit, offset } = parsePagination(query);
    const {
      user_id, status, account_id, start_date, end_date, keyword
    } = query;

    const where = {};

    // 数据隔离
    if (userRole === 'agent') {
      where.created_by = userId;
    }

    if (user_id) where.user_id = parseInt(user_id, 10);
    if (status) where.status = status;
    if (account_id) where.account_id = parseInt(account_id, 10);

    if (start_date || end_date) {
      where.loan_date = {};
      if (start_date) where.loan_date[Op.gte] = start_date;
      if (end_date) where.loan_date[Op.lte] = end_date;
    }

    if (keyword) {
      where[Op.or] = [
        { purpose: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } },
        { sp_no: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await Loan.findAndCountAll({
      where,
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] }
      ],
      order: [['loan_date', 'DESC'], ['create_time', 'DESC']],
      offset,
      limit
    });

    // 附加"剩余应还"字段，前端展示方便
    const list = data.rows.map(loan => {
      const obj = loan.toJSON();
      const amount = parseFloat(obj.amount) || 0;
      const repaid = parseFloat(obj.repaid_amount) || 0;
      obj.remaining_amount = parseFloat((amount - repaid).toFixed(2));
      return obj;
    });

    return {
      list,
      pagination: {
        page,
        limit,
        total: data.count,
        totalPages: Math.ceil(data.count / limit)
      }
    };
  }

  /**
   * 获取借款详情（含还款明细）
   */
  async getDetail(id, userId, userRole) {
    const loan = await Loan.findByPk(id, {
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] },
        {
          model: LoanRepayment,
          as: 'repayments',
          include: [
            { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] }
          ],
          separate: true,
          order: [['repay_date', 'DESC'], ['create_time', 'DESC']]
        }
      ]
    });
    if (!loan) {
      throw new NotFoundError('借款单不存在');
    }
    // 数据隔离：agent 仅能查看自己创建的记录
    if (userRole === 'agent' && loan.created_by !== userId) {
      throw new NotFoundError('借款单不存在');
    }

    const obj = loan.toJSON();
    const amount = parseFloat(obj.amount) || 0;
    const repaid = parseFloat(obj.repaid_amount) || 0;
    obj.remaining_amount = parseFloat((amount - repaid).toFixed(2));
    return obj;
  }

  /**
   * 创建借款单
   */
  async create(data, userId) {
    if (!data.user_id) {
      throw new ValidationError('请选择借款人');
    }
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('借款金额必须大于0');
    }
    if (!data.loan_date) {
      throw new ValidationError('请选择借款日期');
    }

    if (data.account_id) {
      const account = await BankAccount.findByPk(data.account_id);
      if (!account) {
        throw new NotFoundError('付款账户不存在');
      }
      if (account.status !== 1) {
        throw new ValidationError('付款账户已停用');
      }
    }

    if (data.sp_no) {
      const existing = await Loan.findOne({ where: { sp_no: data.sp_no } });
      if (existing) {
        throw new ValidationError(`审批单号 ${data.sp_no} 已存在，不可重复同步`);
      }
    }

    const loan = await Loan.create({
      ...data,
      amount: parseFloat(data.amount),
      repaid_amount: 0,
      status: 'unpaid',
      created_by: userId
    });

    return loan;
  }

  /**
   * 更新借款单
   *
   * 说明：
   *   - repaid_amount 和 status 由系统自动维护，不允许外部直接修改
   *   - 修改 amount 后需重新评估 status（极少场景，但要正确处理）
   */
  async update(id, data, userId, userRole) {
    const loan = await Loan.findByPk(id);
    if (!loan) {
      throw new NotFoundError('借款单不存在');
    }

    if (userRole === 'agent' && loan.created_by !== userId) {
      throw new ValidationError('无权编辑该借款单');
    }

    // 剥离受系统管控的字段
    const safeData = { ...data };
    delete safeData.repaid_amount;
    delete safeData.status;

    if (safeData.account_id && safeData.account_id !== loan.account_id) {
      const account = await BankAccount.findByPk(safeData.account_id);
      if (!account) {
        throw new NotFoundError('付款账户不存在');
      }
      if (account.status !== 1) {
        throw new ValidationError('付款账户已停用');
      }
    }

    if (safeData.amount !== undefined) {
      const amt = parseFloat(safeData.amount);
      if (!amt || amt <= 0) {
        throw new ValidationError('借款金额必须大于0');
      }
      safeData.amount = amt;
    }

    await loan.update(safeData);

    // 若金额变更，重新推导 status（不改 repaid_amount）
    if (safeData.amount !== undefined) {
      await this._refreshStatus(loan.id);
    }

    return await Loan.findByPk(loan.id);
  }

  /**
   * 删除借款单（级联删除还款记录）
   */
  async delete(id, userId, userRole) {
    const loan = await Loan.findByPk(id);
    if (!loan) {
      throw new NotFoundError('借款单不存在');
    }

    if (userRole === 'agent' && loan.created_by !== userId) {
      throw new ValidationError('无权删除该借款单');
    }

    await sequelize.transaction(async (t) => {
      // 先删还款记录
      await LoanRepayment.destroy({
        where: { loan_id: loan.id },
        transaction: t
      });
      await loan.destroy({ transaction: t });
    });

    return { id };
  }

  /**
   * 新增还款记录
   *
   * 事务：
   *   1) 校验还款后不会超出借款金额
   *   2) 写入 LoanRepayment
   *   3) 重算 Loan.repaid_amount + status
   *
   * @param {number} loanId
   * @param {Object} data { amount, repay_date, account_id, remark }
   * @param {number} userId
   * @param {string} userRole
   */
  async addRepayment(loanId, data, userId, userRole) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) {
      throw new NotFoundError('借款单不存在');
    }

    if (userRole === 'agent' && loan.created_by !== userId) {
      throw new ValidationError('无权对该借款单进行还款');
    }

    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('还款金额必须大于0');
    }
    if (!data.repay_date) {
      throw new ValidationError('请选择还款日期');
    }

    if (data.account_id) {
      const account = await BankAccount.findByPk(data.account_id);
      if (!account) {
        throw new NotFoundError('收款账户不存在');
      }
      if (account.status !== 1) {
        throw new ValidationError('收款账户已停用');
      }
    }

    const amt = parseFloat(data.amount);

    // 事务 + 行锁：锁定借款行后再校验「不超额」，避免并发还款各自读到旧 repaid_amount 导致超还
    const repayment = await sequelize.transaction(async (t) => {
      const locked = await Loan.findByPk(loanId, { transaction: t, lock: t.LOCK.UPDATE });
      const currentRepaid = parseFloat(locked.repaid_amount) || 0;
      const loanAmount = parseFloat(locked.amount) || 0;
      // 已还 + 本次 超过借款金额时拦截（允许等于，即一次性还清；0.01 容差避免浮点误差）
      if (currentRepaid + amt > loanAmount + 0.01) {
        const remaining = parseFloat((loanAmount - currentRepaid).toFixed(2));
        throw new ValidationError(`还款金额超出剩余应还（${remaining}），请核对金额`);
      }

      const rp = await LoanRepayment.create({
        loan_id: loan.id,
        amount: amt,
        repay_date: data.repay_date,
        account_id: data.account_id || null,
        remark: data.remark || null,
        created_by: userId
      }, { transaction: t });

      // 重算 loan.repaid_amount + status（事务内）
      await this._refreshLoanAggregates(loan.id, t);

      return rp;
    });

    return repayment;
  }

  /**
   * 删除还款记录（事务内回算 repaid_amount + status）
   */
  async deleteRepayment(loanId, repaymentId, userId, userRole) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) {
      throw new NotFoundError('借款单不存在');
    }

    if (userRole === 'agent' && loan.created_by !== userId) {
      throw new ValidationError('无权删除该还款记录');
    }

    const repayment = await LoanRepayment.findOne({
      where: { id: repaymentId, loan_id: loanId }
    });
    if (!repayment) {
      throw new NotFoundError('还款记录不存在');
    }

    await sequelize.transaction(async (t) => {
      await repayment.destroy({ transaction: t });
      await this._refreshLoanAggregates(loan.id, t);
    });

    return { id: repaymentId };
  }

  /**
   * 借款概况统计（分状态 + 总金额）
   */
  async getSummary(query) {
    const { user_id } = query || {};

    const where = [];
    const replacements = {};

    if (user_id) {
      where.push('user_id = :user_id');
      replacements.user_id = parseInt(user_id, 10);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const sql = `
      SELECT
        status,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS total_amount,
        COALESCE(SUM(repaid_amount), 0) AS repaid_amount
      FROM loans
      ${whereClause}
      GROUP BY status
    `;

    const rows = await sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT
    });

    const summary = {
      unpaid:  { count: 0, total_amount: 0, repaid_amount: 0, remaining_amount: 0 },
      partial: { count: 0, total_amount: 0, repaid_amount: 0, remaining_amount: 0 },
      paid:    { count: 0, total_amount: 0, repaid_amount: 0, remaining_amount: 0 }
    };

    for (const r of rows) {
      if (!summary[r.status]) continue;
      const total = parseFloat(r.total_amount) || 0;
      const repaid = parseFloat(r.repaid_amount) || 0;
      summary[r.status] = {
        count: parseInt(r.count, 10),
        total_amount: parseFloat(total.toFixed(2)),
        repaid_amount: parseFloat(repaid.toFixed(2)),
        remaining_amount: parseFloat((total - repaid).toFixed(2))
      };
    }

    // 合计
    const all = {
      count: summary.unpaid.count + summary.partial.count + summary.paid.count,
      total_amount: parseFloat(
        (summary.unpaid.total_amount + summary.partial.total_amount + summary.paid.total_amount).toFixed(2)
      ),
      repaid_amount: parseFloat(
        (summary.unpaid.repaid_amount + summary.partial.repaid_amount + summary.paid.repaid_amount).toFixed(2)
      )
    };
    all.remaining_amount = parseFloat((all.total_amount - all.repaid_amount).toFixed(2));

    return { by_status: summary, total: all };
  }

  /**
   * 【私有】重算 loan 的 repaid_amount 和 status
   *
   * @param {number} loanId
   * @param {import('sequelize').Transaction} transaction
   */
  async _refreshLoanAggregates(loanId, transaction) {
    // 1) 聚合还款总额
    const [row] = await sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM loan_repayments WHERE loan_id = ?`,
      {
        replacements: [loanId],
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const repaid = parseFloat((parseFloat(row.total) || 0).toFixed(2));

    // 2) 查 loan 计算 status
    const loan = await Loan.findByPk(loanId, { transaction });
    if (!loan) return;

    const amount = parseFloat(loan.amount) || 0;
    const status = this._deriveStatus(repaid, amount);

    await loan.update(
      { repaid_amount: repaid, status },
      { transaction }
    );
  }

  /**
   * 【私有】仅刷新 status（当 amount 变化时使用）
   */
  async _refreshStatus(loanId) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) return;
    const amount = parseFloat(loan.amount) || 0;
    const repaid = parseFloat(loan.repaid_amount) || 0;
    const status = this._deriveStatus(repaid, amount);
    if (status !== loan.status) {
      await loan.update({ status });
    }
  }

  /**
   * 【私有】根据 repaid / amount 推导还款状态
   *
   * - repaid <= 0            → unpaid
   * - 0 < repaid < amount    → partial
   * - repaid >= amount       → paid
   * 容差 0.01 避免浮点误差
   */
  _deriveStatus(repaid, amount) {
    if (repaid <= 0.0001) return 'unpaid';
    if (repaid + 0.01 >= amount) return 'paid';
    return 'partial';
  }
}

module.exports = new LoanService();
