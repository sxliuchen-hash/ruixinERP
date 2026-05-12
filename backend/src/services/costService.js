/**
 * ============================================================
 * 成本管理业务服务（CostService）
 * ============================================================
 *
 * 【业务范围】
 *   1) 成本分类（CostCategory）CRUD + 树形结构
 *   2) 成本记录（CostRecord）CRUD
 *   3) 月度/季度/年度汇总 + 同比环比
 *   4) 按类别/按大类聚合（Dashboard 饼图数据源）
 *   5) 费用类 payment 自动联动写入 cost_records（写入/更新/删除）
 *
 * 【与 Payment 的关系】
 *   费用类 payment（category='fee' 且 confirm_status='confirmed'）
 *   视作"已发生成本"，自动写/同步一条 cost_record（payment_id 关联），
 *   便于统一的成本统计；反过来直接录入的 cost_record 不产生 payment。
 *
 *   联动规则（由 paymentService 调用本服务的 syncFromPayment）：
 *   - 创建费用类 + confirmed：插入 cost_record
 *   - 编辑费用类：按 payment_id 匹配更新
 *   - 删除/改为非费用类/改为 pending：删除关联 cost_record
 *
 * 【类别树】
 *   cost_categories 支持两级分层：parent_id=NULL 顶层（labor/operation/...）,
 *   二级为具体子类；getCategoryTree 返回嵌套结构。
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const CostCategory = require('../models/CostCategory');
const CostRecord = require('../models/CostRecord');
const BankAccount = require('../models/BankAccount');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

class CostService {
  // ==================== 成本分类 CRUD ====================

  /**
   * 获取所有成本类别（平铺）
   *
   * @param {Object} query
   * @param {string} [query.type]    过滤大类
   * @param {number} [query.status]  1 启用 / 0 停用
   * @returns {Promise<Array>}
   */
  async getCategoryList(query) {
    const { type, status } = query || {};
    const where = {};
    if (type) where.type = type;
    if (status !== undefined && status !== '') where.status = parseInt(status, 10);

    return await CostCategory.findAll({
      where,
      order: [['sort_order', 'ASC'], ['id', 'ASC']]
    });
  }

  /**
   * 获取成本类别树（两级嵌套）
   */
  async getCategoryTree() {
    const all = await CostCategory.findAll({
      where: { status: 1 },
      order: [['sort_order', 'ASC'], ['id', 'ASC']]
    });

    const plain = all.map(c => c.toJSON());
    const topLevel = plain.filter(c => !c.parent_id);
    const byParent = {};
    plain.forEach(c => {
      if (c.parent_id) {
        if (!byParent[c.parent_id]) byParent[c.parent_id] = [];
        byParent[c.parent_id].push(c);
      }
    });

    return topLevel.map(t => ({
      ...t,
      children: byParent[t.id] || []
    }));
  }

  /**
   * 创建成本类别
   */
  async createCategory(data) {
    if (!data.name) throw new ValidationError('类别名称不能为空');
    if (!data.type) throw new ValidationError('请选择大类');

    // 校验 parent 存在且属于同一大类
    if (data.parent_id) {
      const parent = await CostCategory.findByPk(data.parent_id);
      if (!parent) throw new NotFoundError('父类别不存在');
      if (parent.type !== data.type) {
        throw new ValidationError('子类别的大类必须与父类别一致');
      }
    }

    return await CostCategory.create({
      name: data.name,
      parent_id: data.parent_id || null,
      type: data.type,
      sort_order: data.sort_order || 0,
      status: data.status !== undefined ? data.status : 1
    });
  }

  /**
   * 更新成本类别
   */
  async updateCategory(id, data) {
    const cat = await CostCategory.findByPk(id);
    if (!cat) throw new NotFoundError('类别不存在');

    // 不允许把自己改为自己的父节点
    if (data.parent_id && data.parent_id === id) {
      throw new ValidationError('不能将类别的父级设为自身');
    }
    if (data.parent_id) {
      const parent = await CostCategory.findByPk(data.parent_id);
      if (!parent) throw new NotFoundError('父类别不存在');
      const effectiveType = data.type || cat.type;
      if (parent.type !== effectiveType) {
        throw new ValidationError('子类别的大类必须与父类别一致');
      }
    }

    await cat.update(data);
    return cat;
  }

  /**
   * 删除成本类别
   *
   * 安全检查：
   *   - 该类别有关联的 cost_records / payments 则拒绝删除
   *   - 该类别有子类别则拒绝删除
   */
  async deleteCategory(id) {
    const cat = await CostCategory.findByPk(id);
    if (!cat) throw new NotFoundError('类别不存在');

    // 检查子类别
    const childCount = await CostCategory.count({ where: { parent_id: id } });
    if (childCount > 0) {
      throw new ValidationError(`该类别下有 ${childCount} 个子类别，请先删除子类别`);
    }

    // 检查 cost_records 引用
    const recordCount = await CostRecord.count({ where: { category_id: id } });
    if (recordCount > 0) {
      throw new ValidationError(`该类别下有 ${recordCount} 条成本记录，不可删除（可改为停用）`);
    }

    // 检查 payments 引用
    const [pRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM payments WHERE cost_category_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (parseInt(pRow.cnt, 10) > 0) {
      throw new ValidationError(`该类别下有 ${pRow.cnt} 条收付款记录，不可删除（可改为停用）`);
    }

    await cat.destroy();
    return { id };
  }

  // ==================== 成本记录 CRUD ====================

  /**
   * 获取成本记录列表（分页 + 筛选）
   *
   * @param {Object} query
   * @param {number} [query.category_id]
   * @param {string} [query.type]           按 category.type 过滤（需 JOIN）
   * @param {string} [query.cost_month]     '2026-05'
   * @param {number} [query.user_id]
   * @param {number} [query.is_recurring]
   * @param {string} [query.start_month]    按月区间起 '2026-01'
   * @param {string} [query.end_month]      按月区间止 '2026-05'
   * @param {string} [query.keyword]
   */
  async getRecordList(query) {
    const { page, limit, offset } = parsePagination(query);
    const {
      category_id, type, cost_month, user_id, is_recurring,
      start_month, end_month, keyword
    } = query;

    const where = [];
    const replacements = {};

    if (category_id) {
      where.push('r.category_id = :category_id');
      replacements.category_id = parseInt(category_id, 10);
    }
    if (type) {
      where.push('c.type = :type');
      replacements.type = type;
    }
    if (cost_month) {
      where.push('r.cost_month = :cost_month');
      replacements.cost_month = cost_month;
    }
    if (user_id) {
      where.push('r.user_id = :user_id');
      replacements.user_id = parseInt(user_id, 10);
    }
    if (is_recurring !== undefined && is_recurring !== '') {
      where.push('r.is_recurring = :is_recurring');
      replacements.is_recurring = parseInt(is_recurring, 10);
    }
    if (start_month) {
      where.push('r.cost_month >= :start_month');
      replacements.start_month = start_month;
    }
    if (end_month) {
      where.push('r.cost_month <= :end_month');
      replacements.end_month = end_month;
    }
    if (keyword) {
      where.push('(r.summary LIKE :keyword OR r.remark LIKE :keyword)');
      replacements.keyword = `%${keyword}%`;
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // 总数
    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       ${whereSql}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countRow.total, 10);

    // 列表
    const rows = await sequelize.query(
      `SELECT
         r.id, r.category_id, r.amount, r.cost_month, r.user_id,
         r.payment_id, r.account_id, r.is_recurring, r.summary,
         r.remark, r.created_by, r.create_time, r.update_time,
         c.name AS category_name, c.type AS category_type
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       ${whereSql}
       ORDER BY r.cost_month DESC, r.create_time DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...replacements, limit, offset },
        type: QueryTypes.SELECT
      }
    );

    return {
      list: rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount) || 0
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 创建成本记录
   */
  async createRecord(data, userId) {
    if (!data.category_id) throw new ValidationError('请选择成本类别');
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('金额必须大于0');
    }
    if (!data.cost_month) throw new ValidationError('请选择所属月份');

    const cat = await CostCategory.findByPk(data.category_id);
    if (!cat) throw new NotFoundError('成本类别不存在');

    if (data.account_id) {
      const acc = await BankAccount.findByPk(data.account_id);
      if (!acc) throw new NotFoundError('付款账户不存在');
    }

    return await CostRecord.create({
      category_id: data.category_id,
      amount: parseFloat(data.amount),
      cost_month: data.cost_month,
      user_id: data.user_id || null,
      payment_id: data.payment_id || null,
      account_id: data.account_id || null,
      is_recurring: data.is_recurring ? 1 : 0,
      summary: data.summary || null,
      remark: data.remark || null,
      created_by: userId
    });
  }

  /**
   * 更新成本记录
   */
  async updateRecord(id, data) {
    const record = await CostRecord.findByPk(id);
    if (!record) throw new NotFoundError('成本记录不存在');

    if (data.category_id && data.category_id !== record.category_id) {
      const cat = await CostCategory.findByPk(data.category_id);
      if (!cat) throw new NotFoundError('成本类别不存在');
    }
    if (data.amount !== undefined) {
      const amt = parseFloat(data.amount);
      if (!amt || amt <= 0) throw new ValidationError('金额必须大于0');
      data.amount = amt;
    }

    await record.update(data);
    return record;
  }

  /**
   * 删除成本记录
   */
  async deleteRecord(id) {
    const record = await CostRecord.findByPk(id);
    if (!record) throw new NotFoundError('成本记录不存在');
    await record.destroy();
    return { id };
  }

  // ==================== 汇总分析 ====================

  /**
   * 按月汇总（近 N 个月）
   *
   * @param {Object} query
   * @param {number} [query.months=12]
   * @param {string} [query.type]  按大类过滤
   * @returns {Promise<Array<{month, total, by_type: Object}>>}
   */
  async getMonthlySummary(query) {
    const months = parseInt(query?.months, 10) || 12;
    const type = query?.type;

    // 生成近 N 个月的 YYYY-MM 列表（便于无数据月份补 0）
    const monthList = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthList.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      );
    }
    const earliestMonth = monthList[0];

    const where = ['r.cost_month >= :earliest'];
    const replacements = { earliest: earliestMonth };
    if (type) {
      where.push('c.type = :type');
      replacements.type = type;
    }

    const rows = await sequelize.query(
      `SELECT
         r.cost_month AS month,
         c.type AS category_type,
         COALESCE(SUM(r.amount), 0) AS total
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       WHERE ${where.join(' AND ')}
       GROUP BY r.cost_month, c.type
       ORDER BY r.cost_month ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    // 按月份聚合：{month: {total: x, by_type: {...}}}
    const byMonth = {};
    for (const m of monthList) {
      byMonth[m] = { month: m, total: 0, by_type: {} };
    }
    for (const r of rows) {
      const m = r.month;
      if (!byMonth[m]) continue;
      const amt = parseFloat(r.total) || 0;
      byMonth[m].total += amt;
      const t = r.category_type || 'other';
      byMonth[m].by_type[t] = (byMonth[m].by_type[t] || 0) + amt;
    }

    return Object.values(byMonth).map(m => ({
      month: m.month,
      total: parseFloat(m.total.toFixed(2)),
      by_type: Object.fromEntries(
        Object.entries(m.by_type).map(([k, v]) => [k, parseFloat(v.toFixed(2))])
      )
    }));
  }

  /**
   * 按大类汇总（Dashboard 饼图数据源）
   *
   * @param {Object} query
   * @param {string} [query.start_month]  '2026-01'
   * @param {string} [query.end_month]    '2026-05'
   * @returns {Promise<{list: Array<{category_type, total}>, total: number}>}
   */
  async getTypeBreakdown(query) {
    const where = [];
    const replacements = {};

    if (query?.start_month) {
      where.push('r.cost_month >= :start_month');
      replacements.start_month = query.start_month;
    }
    if (query?.end_month) {
      where.push('r.cost_month <= :end_month');
      replacements.end_month = query.end_month;
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await sequelize.query(
      `SELECT
         COALESCE(c.type, 'other') AS category_type,
         COALESCE(SUM(r.amount), 0) AS total
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       ${whereSql}
       GROUP BY c.type
       ORDER BY total DESC`,
      { replacements, type: QueryTypes.SELECT }
    );

    const list = rows.map(r => ({
      category_type: r.category_type,
      total: parseFloat(parseFloat(r.total).toFixed(2))
    }));
    const total = parseFloat(list.reduce((s, x) => s + x.total, 0).toFixed(2));

    return { list, total };
  }

  /**
   * 按二级类别汇总（细粒度，列表页小计用）
   */
  async getCategoryBreakdown(query) {
    const where = [];
    const replacements = {};

    if (query?.start_month) {
      where.push('r.cost_month >= :start_month');
      replacements.start_month = query.start_month;
    }
    if (query?.end_month) {
      where.push('r.cost_month <= :end_month');
      replacements.end_month = query.end_month;
    }
    if (query?.type) {
      where.push('c.type = :type');
      replacements.type = query.type;
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await sequelize.query(
      `SELECT
         r.category_id,
         c.name AS category_name,
         c.type AS category_type,
         COALESCE(SUM(r.amount), 0) AS total,
         COUNT(*) AS count
       FROM cost_records r
       LEFT JOIN cost_categories c ON c.id = r.category_id
       ${whereSql}
       GROUP BY r.category_id, c.name, c.type
       ORDER BY total DESC`,
      { replacements, type: QueryTypes.SELECT }
    );

    return rows.map(r => ({
      category_id: r.category_id,
      category_name: r.category_name || '未分类',
      category_type: r.category_type || 'other',
      count: parseInt(r.count, 10),
      total: parseFloat(parseFloat(r.total).toFixed(2))
    }));
  }

  /**
   * 同比环比
   *
   * @param {Object} query
   * @param {string} [query.month]  目标月份 '2026-05'（默认本月）
   * @returns {Promise<{
   *   current: {month, total},
   *   prev_month: {month, total, delta, delta_pct},
   *   prev_year: {month, total, delta, delta_pct}
   * }>}
   */
  async getYoyMom(query) {
    // 目标月份（默认本月）
    const now = new Date();
    const target = query?.month
      || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 上个月
    const [ty, tm] = target.split('-').map(Number);
    const prevD = new Date(ty, tm - 2, 1); // tm-1 为当前月, tm-2 为上个月
    const prevMonth = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;

    // 去年同期
    const prevYear = `${ty - 1}-${String(tm).padStart(2, '0')}`;

    const query3 = async (month) => {
      const [row] = await sequelize.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM cost_records WHERE cost_month = :m`,
        { replacements: { m: month }, type: QueryTypes.SELECT }
      );
      return parseFloat(row.total) || 0;
    };

    const [curr, prev, yoy] = await Promise.all([
      query3(target),
      query3(prevMonth),
      query3(prevYear)
    ]);

    const delta = (a, b) => parseFloat((a - b).toFixed(2));
    const deltaPct = (a, b) => b === 0 ? null : parseFloat(((a - b) / b * 100).toFixed(2));

    return {
      current: { month: target, total: parseFloat(curr.toFixed(2)) },
      prev_month: {
        month: prevMonth,
        total: parseFloat(prev.toFixed(2)),
        delta: delta(curr, prev),
        delta_pct: deltaPct(curr, prev)
      },
      prev_year: {
        month: prevYear,
        total: parseFloat(yoy.toFixed(2)),
        delta: delta(curr, yoy),
        delta_pct: deltaPct(curr, yoy)
      }
    };
  }

  // ==================== Payment 联动（供 paymentService 调用）====================

  /**
   * 基于 payment 同步一条 cost_record
   *
   * 触发条件：payment.category='fee' 且 confirm_status='confirmed'
   * 行为：
   *   - 若已有 payment_id 关联的 record → 更新
   *   - 否则 → 新增
   *
   * @param {Payment} payment 已保存的 payment 实例
   * @param {import('sequelize').Transaction} [transaction] 可选事务
   */
  async syncFromPayment(payment, transaction) {
    if (payment.category !== 'fee') return null;
    if (payment.confirm_status !== 'confirmed') return null;
    if (!payment.cost_category_id) {
      // 没有类别就不写 cost_record（保留 payment 便于后续补类别）
      return null;
    }

    // cost_month 从 payment_date 派生
    const d = new Date(payment.payment_date);
    const costMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const existing = await CostRecord.findOne({
      where: { payment_id: payment.id },
      transaction
    });

    const data = {
      category_id: payment.cost_category_id,
      amount: parseFloat(payment.amount) || 0,
      cost_month: costMonth,
      payment_id: payment.id,
      account_id: payment.account_id || null,
      is_recurring: 0,
      summary: payment.summary || null,
      remark: payment.remark || null,
      created_by: payment.created_by || null
    };

    if (existing) {
      await existing.update(data, { transaction });
      return existing;
    }
    return await CostRecord.create(data, { transaction });
  }

  /**
   * 基于 payment 删除对应 cost_record（若存在）
   *
   * 触发条件：payment 被删除 / 改为非费用类 / 改为 pending
   */
  async removeFromPayment(paymentId, transaction) {
    const existing = await CostRecord.findOne({
      where: { payment_id: paymentId },
      transaction
    });
    if (existing) {
      await existing.destroy({ transaction });
      return { removed: true };
    }
    return { removed: false };
  }

  /**
   * 固定月费自动生成（供 recurringCostJob 调用）
   *
   * 规则：
   *   1) 查出所有 is_recurring=1 的模板记录（取每个 (category_id, user_id) 组合的最新一条作为模板）
   *   2) 若目标月份（默认本月）尚无该模板对应的 (category_id, user_id, cost_month) 记录 → 复制一条
   *   3) 新记录保留 is_recurring=1 标记，形成链式生成
   *
   * @param {string} [targetMonth='YYYY-MM']  默认为当前月
   * @returns {Promise<{generated: number, details: Array}>}
   */
  async generateRecurringRecords(targetMonth) {
    const now = new Date();
    const month = targetMonth
      || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 取每个 (category_id, user_id) 组合的最新模板（is_recurring=1）
    const templates = await sequelize.query(
      `SELECT r.*
       FROM cost_records r
       INNER JOIN (
         SELECT category_id, COALESCE(user_id, 0) AS uid, MAX(id) AS max_id
         FROM cost_records
         WHERE is_recurring = 1
         GROUP BY category_id, COALESCE(user_id, 0)
       ) t ON t.max_id = r.id`,
      { type: QueryTypes.SELECT }
    );

    const generated = [];

    for (const tpl of templates) {
      // 检查目标月份是否已有对应记录
      const existing = await CostRecord.findOne({
        where: {
          category_id: tpl.category_id,
          cost_month: month,
          user_id: tpl.user_id || null,
          is_recurring: 1
        }
      });
      if (existing) continue;

      // 复制一条
      const created = await CostRecord.create({
        category_id: tpl.category_id,
        amount: tpl.amount,
        cost_month: month,
        user_id: tpl.user_id || null,
        account_id: tpl.account_id || null,
        is_recurring: 1,
        summary: tpl.summary ? `${tpl.summary}（自动生成）` : `固定月费 ${month}`,
        remark: tpl.remark,
        created_by: tpl.created_by
      });

      generated.push({
        id: created.id,
        category_id: created.category_id,
        amount: parseFloat(created.amount)
      });
    }

    return {
      generated: generated.length,
      month,
      details: generated
    };
  }
}

module.exports = new CostService();
