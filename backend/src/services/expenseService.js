/**
 * ============================================================
 * 报销业务服务（ExpenseService）
 * ============================================================
 *
 * 【设计定位】
 * 报销单是"人+事+钱"的业务视角，独立于 payments 单据。
 * confirmed 后由 accountService.calculateBalance 聚合进账户余额，
 * 因此本服务本身只负责单据的 CRUD 和统计，不直接更新账户。
 *
 * 【两个状态】
 *   - pending   ：企微同步或草稿，不影响账户余额
 *   - confirmed ：已确认，实时反映到账户余额
 *
 * 【数据隔离】
 *   路由按权限 grant 生成 created_by 的 self/team/all 范围。
 *   服务层缺失或收到非法 dataFilter 时必须 fail-closed。
 *
 * 【统计分析】
 *   - 按类别汇总（getCategorySummary）
 *   - 按人员汇总（getUserSummary）
 *   - 按月度汇总（getMonthlySummary）
 *   只统计 confirmed 的记录，pending 不计入。
 * ============================================================
 */

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const Expense = require('../models/Expense');
const BankAccount = require('../models/BankAccount');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

const DENY_DATA_FILTER = Object.freeze({ created_by: -1 });

function normalizeDataFilter(dataFilter) {
  if (!dataFilter || typeof dataFilter !== 'object' || Array.isArray(dataFilter)) {
    return { ...DENY_DATA_FILTER };
  }

  const keys = Object.keys(dataFilter);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== 'created_by') return { ...DENY_DATA_FILTER };

  const ownerScope = dataFilter.created_by;
  if (Number.isInteger(Number(ownerScope))) {
    return { created_by: Number(ownerScope) };
  }

  const teamIds = ownerScope && typeof ownerScope === 'object'
    ? ownerScope[Op.in]
    : null;
  if (!Array.isArray(teamIds)) return { ...DENY_DATA_FILTER };

  const normalizedIds = [...new Set(teamIds
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];

  return normalizedIds.length > 0
    ? { created_by: { [Op.in]: normalizedIds } }
    : { ...DENY_DATA_FILTER };
}

function appendSqlDataFilter(where, replacements, dataFilter, alias = '') {
  const normalized = normalizeDataFilter(dataFilter);
  if (Object.keys(normalized).length === 0) return;

  const column = alias ? `${alias}.created_by` : 'created_by';
  const ownerScope = normalized.created_by;
  if (Number.isInteger(ownerScope)) {
    where.push(`${column} = :scope_created_by`);
    replacements.scope_created_by = ownerScope;
    return;
  }

  const teamIds = ownerScope && typeof ownerScope === 'object'
    ? ownerScope[Op.in]
    : null;
  if (Array.isArray(teamIds) && teamIds.length > 0) {
    where.push(`${column} IN (:scope_created_by_ids)`);
    replacements.scope_created_by_ids = teamIds;
    return;
  }

  where.push('1 = 0');
}

class ExpenseService {
  /**
   * 获取报销列表（分页 + 多维筛选）
   *
   * @param {Object} query
   * @param {number} [query.user_id]         报销人
   * @param {number} [query.cost_category_id] 类别
   * @param {number} [query.account_id]      付款账户
   * @param {string} [query.confirm_status]  确认状态
   * @param {string} [query.start_date]      起始日期（expense_date）
   * @param {string} [query.end_date]        截止日期
   * @param {string} [query.keyword]         关键词（summary/remark/sp_no 模糊匹配）
   * @param {Object} dataFilter attachPermissionDataScope 生成的范围
   */
  async getList(query, dataFilter) {
    const { page, limit, offset } = parsePagination(query);
    const {
      user_id, cost_category_id, account_id, confirm_status,
      start_date, end_date, keyword
    } = query;

    const where = normalizeDataFilter(dataFilter);

    if (user_id) where.user_id = parseInt(user_id, 10);
    if (cost_category_id) where.cost_category_id = parseInt(cost_category_id, 10);
    if (account_id) where.account_id = parseInt(account_id, 10);
    if (confirm_status) where.confirm_status = confirm_status;

    if (start_date || end_date) {
      where.expense_date = {};
      if (start_date) where.expense_date[Op.gte] = start_date;
      if (end_date) where.expense_date[Op.lte] = end_date;
    }

    if (keyword) {
      where[Op.or] = [
        { summary: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } },
        { sp_no: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await Expense.findAndCountAll({
      where,
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] }
      ],
      order: [['expense_date', 'DESC'], ['create_time', 'DESC']],
      offset,
      limit
    });

    return {
      list: data.rows,
      pagination: {
        page,
        limit,
        total: data.count,
        totalPages: Math.ceil(data.count / limit)
      }
    };
  }

  /**
   * 获取报销详情
   */
  async getDetail(id, dataFilter) {
    const expense = await Expense.findOne({
      where: { id, ...normalizeDataFilter(dataFilter) },
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] }
      ]
    });
    if (!expense) {
      throw new NotFoundError('报销单不存在');
    }
    return expense;
  }

  /**
   * 创建报销单
   *
   * @param {Object} data 报销数据
   * @param {number} userId 创建人 ID
   */
  async create(data, userId) {
    if (!data.user_id) {
      throw new ValidationError('请选择报销人');
    }
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('金额必须大于0');
    }
    if (!data.expense_date) {
      throw new ValidationError('请选择费用发生日期');
    }

    // 如果传了 account_id，校验账户存在且启用
    if (data.account_id) {
      const account = await BankAccount.findByPk(data.account_id);
      if (!account) {
        throw new NotFoundError('付款账户不存在');
      }
      if (account.status !== 1) {
        throw new ValidationError('付款账户已停用');
      }
    }

    // sp_no 幂等（企微同步场景）
    if (data.sp_no) {
      const existing = await Expense.findOne({ where: { sp_no: data.sp_no } });
      if (existing) {
        throw new ValidationError(`审批单号 ${data.sp_no} 已存在，不可重复同步`);
      }
    }

    const expense = await Expense.create({
      ...data,
      amount: parseFloat(data.amount),
      created_by: userId
    });

    return expense;
  }

  /**
   * 更新报销单
   *
   * 说明：
   *   - 报销不像 payment 那样需要事务更新合同 paid_amount，
   *     账户余额由 accountService 实时聚合，所以单据更新不需要事务
   *   - 但仍要校验数据隔离和外键合法性
   */
  async update(id, data, dataFilter) {
    const expense = await Expense.findOne({
      where: { id, ...normalizeDataFilter(dataFilter) }
    });
    if (!expense) {
      throw new NotFoundError('报销单不存在');
    }

    if (data.account_id && data.account_id !== expense.account_id) {
      const account = await BankAccount.findByPk(data.account_id);
      if (!account) {
        throw new NotFoundError('付款账户不存在');
      }
      if (account.status !== 1) {
        throw new ValidationError('付款账户已停用');
      }
    }

    if (data.amount !== undefined) {
      const amt = parseFloat(data.amount);
      if (!amt || amt <= 0) {
        throw new ValidationError('金额必须大于0');
      }
      data.amount = amt;
    }

    await expense.update(data);
    return expense;
  }

  /**
   * 删除报销单
   */
  async delete(id, dataFilter) {
    const expense = await Expense.findOne({
      where: { id, ...normalizeDataFilter(dataFilter) }
    });
    if (!expense) {
      throw new NotFoundError('报销单不存在');
    }

    await expense.destroy();
    return { id };
  }

  /**
   * 确认报销（pending → confirmed）
   * 用于企微审批同步来的 pending 记录的人工确认。
   */
  async confirm(id, dataFilter) {
    const expense = await Expense.findOne({
      where: { id, ...normalizeDataFilter(dataFilter) }
    });
    if (!expense) {
      throw new NotFoundError('报销单不存在');
    }
    if (expense.confirm_status === 'confirmed') {
      throw new ValidationError('该记录已确认，无需重复确认');
    }
    await expense.update({ confirm_status: 'confirmed' });
    return expense;
  }

  /**
   * 按类别汇总（仅统计 confirmed）
   *
   * @param {Object} query
   * @param {string} [query.start_date]
   * @param {string} [query.end_date]
   * @returns {Promise<{list: Array, total: number}>}
   */
  async getCategorySummary(query, dataFilter) {
    const { start_date, end_date } = query || {};

    const where = ['e.confirm_status = :confirmed'];
    const replacements = { confirmed: 'confirmed' };
    appendSqlDataFilter(where, replacements, dataFilter, 'e');

    if (start_date) {
      where.push('e.expense_date >= :start_date');
      replacements.start_date = start_date;
    }
    if (end_date) {
      where.push('e.expense_date <= :end_date');
      replacements.end_date = end_date;
    }

    const sql = `
      SELECT
        e.cost_category_id,
        c.name AS category_name,
        COUNT(*) AS count,
        COALESCE(SUM(e.amount), 0) AS amount
      FROM expenses e
      LEFT JOIN cost_categories c ON c.id = e.cost_category_id
      WHERE ${where.join(' AND ')}
      GROUP BY e.cost_category_id, c.name
      ORDER BY amount DESC
    `;

    const rows = await sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT
    });

    const list = rows.map(r => ({
      cost_category_id: r.cost_category_id,
      category_name: r.category_name || '未分类',
      count: parseInt(r.count, 10),
      amount: parseFloat(parseFloat(r.amount).toFixed(2))
    }));

    const total = parseFloat(list.reduce((s, x) => s + x.amount, 0).toFixed(2));
    return { list, total };
  }

  /**
   * 按报销人汇总（仅统计 confirmed）
   */
  async getUserSummary(query, dataFilter) {
    const { start_date, end_date } = query || {};

    const where = ["confirm_status = :confirmed"];
    const replacements = { confirmed: 'confirmed' };
    appendSqlDataFilter(where, replacements, dataFilter);

    if (start_date) {
      where.push('expense_date >= :start_date');
      replacements.start_date = start_date;
    }
    if (end_date) {
      where.push('expense_date <= :end_date');
      replacements.end_date = end_date;
    }

    const sql = `
      SELECT
        user_id,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS amount
      FROM expenses
      WHERE ${where.join(' AND ')}
      GROUP BY user_id
      ORDER BY amount DESC
    `;

    const rows = await sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT
    });

    const list = rows.map(r => ({
      user_id: r.user_id,
      count: parseInt(r.count, 10),
      amount: parseFloat(parseFloat(r.amount).toFixed(2))
    }));

    const total = parseFloat(list.reduce((s, x) => s + x.amount, 0).toFixed(2));
    return { list, total };
  }

  /**
   * 按月度汇总（最近 N 个月，默认 12 个月，仅统计 confirmed）
   *
   * @param {Object} query
   * @param {number} [query.months=12] 统计月数
   */
  async getMonthlySummary(query, dataFilter) {
    const months = parseInt(query?.months, 10) || 12;

    const where = [
      "confirm_status = 'confirmed'",
      'expense_date >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)'
    ];
    const replacements = { months };
    appendSqlDataFilter(where, replacements, dataFilter);

    const sql = `
      SELECT
        DATE_FORMAT(expense_date, '%Y-%m') AS month,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS amount
      FROM expenses
      WHERE ${where.join(' AND ')}
      GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
      ORDER BY month ASC
    `;

    const rows = await sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT
    });

    return rows.map(r => ({
      month: r.month,
      count: parseInt(r.count, 10),
      amount: parseFloat(parseFloat(r.amount).toFixed(2))
    }));
  }
}

module.exports = new ExpenseService();
