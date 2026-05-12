/**
 * ============================================================
 * 专利库存业务服务（InventoryService）
 * ============================================================
 *
 * 【业务范围】
 *   1) 入库：创建库存记录（patent_no 唯一）
 *   2) 编辑：修改基本信息（不允许直接改 current_price 和 total_maintain_cost）
 *   3) 状态变更：售出（status=sold, stock_out_date 自动填入）/ 放弃 / 转让中
 *   4) 调价：单个调价 + 批量调价（按 tech_field / 按固定比例）
 *   5) 年费：添加年费 → 事务内重算 total_maintain_cost + next_fee_deadline
 *   6) 查询：列表（含库龄、维持成本、利润预估）、详情、总览统计、即将到期
 *
 * 【核心设计】
 *   - 利润预估 = current_price - purchase_price - total_maintain_cost
 *     （在 service 层动态计算，不入库，避免冗余数据不一致）
 *   - 库龄 = DATEDIFF(NOW(), stock_in_date)，同样动态计算
 *   - total_maintain_cost 作为冗余字段维护，由 annual_fees 聚合触发更新
 *   - 调价永远伴随一条 price_history 审计流水（事务保证）
 *
 * 【数据隔离】
 *   agent 只能看自己 created_by 的记录
 *
 * 【并发提醒】
 *   current_price / total_maintain_cost 的更新采用 "select → update" 两步，
 *   高并发下可能出现丢失更新。实际业务调价频次低，先保持简洁。
 * ============================================================
 */

const { Op, QueryTypes, fn, col, literal } = require('sequelize');
const { sequelize } = require('../config/database');
const PatentInventory = require('../models/PatentInventory');
const PatentAnnualFee = require('../models/PatentAnnualFee');
const PatentPriceHistory = require('../models/PatentPriceHistory');
const Supplier = require('../models/Supplier');
const Contract = require('../models/Contract');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

class InventoryService {
  /**
   * 获取库存列表（含库龄、维持成本、利润预估派生字段）
   *
   * @param {Object} query
   * @param {string} [query.status]      状态筛选
   * @param {string} [query.tech_field]  技术领域模糊
   * @param {number} [query.supplier_id] 供应商
   * @param {number} [query.project_id]  交易项目
   * @param {number} [query.min_age]     最小库龄（天）
   * @param {number} [query.max_age]     最大库龄（天）
   * @param {string} [query.sort]        排序：age | profit | price | deadline
   * @param {string} [query.order]       asc | desc（默认 desc）
   * @param {string} [query.keyword]     关键词（patent_no / patent_name / remark）
   */
  async getList(query, userId, userRole) {
    const { page, limit, offset } = parsePagination(query);
    const {
      status, tech_field, supplier_id, project_id,
      min_age, max_age, sort, order, keyword
    } = query;

    const where = {};

    if (userRole === 'agent') {
      where.created_by = userId;
    }

    if (status) where.status = status;
    if (tech_field) where.tech_field = { [Op.like]: `%${tech_field}%` };
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);
    if (project_id) where.project_id = parseInt(project_id, 10);

    // 库龄过滤：DATEDIFF(NOW(), stock_in_date) BETWEEN :min AND :max
    // 用 Sequelize 的 literal 嵌入 DATEDIFF 表达式
    const dateFilters = [];
    if (min_age !== undefined && min_age !== '' && min_age !== null) {
      dateFilters.push(literal(`DATEDIFF(NOW(), stock_in_date) >= ${parseInt(min_age, 10)}`));
    }
    if (max_age !== undefined && max_age !== '' && max_age !== null) {
      dateFilters.push(literal(`DATEDIFF(NOW(), stock_in_date) <= ${parseInt(max_age, 10)}`));
    }
    if (dateFilters.length) {
      where[Op.and] = dateFilters;
    }

    if (keyword) {
      where[Op.or] = [
        { patent_no: { [Op.like]: `%${keyword}%` } },
        { patent_name: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } }
      ];
    }

    // 排序
    let orderClause = [['create_time', 'DESC']];
    const ord = (order === 'asc') ? 'ASC' : 'DESC';
    if (sort === 'age') {
      // 库龄排序 = 按 stock_in_date 反向
      orderClause = [['stock_in_date', ord === 'DESC' ? 'ASC' : 'DESC']];
    } else if (sort === 'profit') {
      orderClause = [
        [literal('(current_price - purchase_price - total_maintain_cost)'), ord]
      ];
    } else if (sort === 'price') {
      orderClause = [['current_price', ord]];
    } else if (sort === 'deadline') {
      orderClause = [['next_fee_deadline', ord]];
    }

    const data = await PatentInventory.findAndCountAll({
      where,
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no', 'title'] }
      ],
      order: orderClause,
      offset,
      limit
    });

    // 附加派生字段
    const list = data.rows.map(inv => this._attachDerivedFields(inv));

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
   * 获取库存详情（含年费记录 + 调价历史）
   */
  async getDetail(id) {
    const inv = await PatentInventory.findByPk(id, {
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no', 'title'] },
        {
          model: PatentAnnualFee,
          as: 'annualFees',
          separate: true,
          order: [['fee_date', 'DESC'], ['create_time', 'DESC']]
        },
        {
          model: PatentPriceHistory,
          as: 'priceHistory',
          separate: true,
          order: [['change_date', 'DESC'], ['create_time', 'DESC']]
        }
      ]
    });

    if (!inv) {
      throw new NotFoundError('库存记录不存在');
    }

    return this._attachDerivedFields(inv);
  }

  /**
   * 创建库存记录（入库）
   */
  async create(data, userId) {
    if (!data.patent_no) {
      throw new ValidationError('专利号不能为空');
    }
    if (!data.patent_name) {
      throw new ValidationError('专利名称不能为空');
    }

    // 专利号唯一性检查
    const existing = await PatentInventory.findOne({ where: { patent_no: data.patent_no } });
    if (existing) {
      throw new ValidationError(`专利号 ${data.patent_no} 已存在`);
    }

    // 外键校验
    if (data.supplier_id) {
      const sup = await Supplier.findByPk(data.supplier_id);
      if (!sup) throw new NotFoundError('供应商不存在');
    }
    if (data.contract_id) {
      const ct = await Contract.findByPk(data.contract_id);
      if (!ct) throw new NotFoundError('关联采购合同不存在');
    }

    // 默认入库日取今天（若未传）
    const stockInDate = data.stock_in_date || new Date().toISOString().slice(0, 10);

    const inv = await PatentInventory.create({
      ...data,
      stock_in_date: stockInDate,
      purchase_price: parseFloat(data.purchase_price || 0),
      current_price: parseFloat(data.current_price || 0),
      total_maintain_cost: 0,
      status: data.status || 'in_stock',
      created_by: userId
    });

    return inv;
  }

  /**
   * 更新库存基本信息（不允许直接改 current_price 和 total_maintain_cost）
   */
  async update(id, data, userId, userRole) {
    const inv = await PatentInventory.findByPk(id);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权编辑该库存记录');
    }

    // 剥离系统管控字段，强制走专用接口维护
    const safeData = { ...data };
    delete safeData.current_price;
    delete safeData.total_maintain_cost;

    // 专利号变更需要重新校验唯一性
    if (safeData.patent_no && safeData.patent_no !== inv.patent_no) {
      const existing = await PatentInventory.findOne({ where: { patent_no: safeData.patent_no } });
      if (existing) {
        throw new ValidationError(`专利号 ${safeData.patent_no} 已存在`);
      }
    }

    await inv.update(safeData);
    return inv;
  }

  /**
   * 变更状态（售出/放弃/转让中/回库）
   *
   * 特殊处理：
   *   - 改为 sold：自动填 stock_out_date（如果前端未指定）
   *   - 改为 in_stock（回库）：清空 stock_out_date
   */
  async changeStatus(id, status, stockOutDate, userId, userRole) {
    if (!['in_stock', 'sold', 'abandoned', 'transferring'].includes(status)) {
      throw new ValidationError('状态值非法');
    }

    const inv = await PatentInventory.findByPk(id);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权变更该库存状态');
    }

    const update = { status };
    if (status === 'sold') {
      update.stock_out_date = stockOutDate || new Date().toISOString().slice(0, 10);
    } else if (status === 'in_stock') {
      update.stock_out_date = null;
    }

    await inv.update(update);
    return inv;
  }

  /**
   * 删除库存记录（级联删除年费和调价历史）
   *
   * 注意：若存在关联的 Payment / Project 等，删除会留下悬空外键，
   * 这里不做强校验（按低优保留），可作为技术债后续完善。
   */
  async delete(id, userId, userRole) {
    const inv = await PatentInventory.findByPk(id);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权删除该库存记录');
    }

    await sequelize.transaction(async (t) => {
      await PatentAnnualFee.destroy({ where: { inventory_id: id }, transaction: t });
      await PatentPriceHistory.destroy({ where: { inventory_id: id }, transaction: t });
      await inv.destroy({ transaction: t });
    });

    return { id };
  }

  /**
   * 单个调价：更新 current_price + 写入一条 price_history（事务）
   *
   * @param {number} id
   * @param {{new_price, change_date?, reason?}} data
   * @param {number} userId
   */
  async changePrice(id, data, userId, userRole) {
    const inv = await PatentInventory.findByPk(id);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权对该库存调价');
    }

    const newPrice = parseFloat(data.new_price);
    if (!(newPrice >= 0)) {
      throw new ValidationError('新价格必须 >= 0');
    }

    const changeDate = data.change_date || new Date().toISOString().slice(0, 10);
    const oldPrice = parseFloat(inv.current_price) || 0;

    await sequelize.transaction(async (t) => {
      await inv.update({ current_price: newPrice }, { transaction: t });
      await PatentPriceHistory.create({
        inventory_id: inv.id,
        old_price: oldPrice,
        new_price: newPrice,
        change_date: changeDate,
        reason: data.reason || null,
        created_by: userId
      }, { transaction: t });
    });

    return await PatentInventory.findByPk(inv.id);
  }

  /**
   * 批量调价
   *
   * 策略二选一：
   *   - mode='fixed'：直接设为 new_price（覆盖式）
   *   - mode='percent'：按百分比调整 current_price，percent 为 +10 或 -5 这种数字
   *
   * 筛选条件（任选组合）：
   *   - ids         ：指定 id 数组
   *   - tech_field  ：按技术领域
   *   - status      ：按状态（默认 in_stock）
   *
   * @param {Object} data
   * @param {'fixed'|'percent'} data.mode
   * @param {number} [data.new_price]   mode=fixed 必填
   * @param {number} [data.percent]     mode=percent 必填（如 10 表示 +10%，-5 表示 -5%）
   * @param {number[]} [data.ids]
   * @param {string} [data.tech_field]
   * @param {string} [data.status]
   * @param {string} [data.reason]
   * @param {string} [data.change_date]
   * @param {number} userId
   * @param {string} userRole
   * @returns {Promise<{affected: number, details: Array}>}
   */
  async batchChangePrice(data, userId, userRole) {
    const { mode, ids, tech_field, status, reason } = data;
    if (!['fixed', 'percent'].includes(mode)) {
      throw new ValidationError('batch mode 必须为 fixed 或 percent');
    }
    if (mode === 'fixed') {
      const p = parseFloat(data.new_price);
      if (!(p >= 0)) throw new ValidationError('fixed 模式下 new_price 必须 >= 0');
    } else {
      const p = parseFloat(data.percent);
      if (isNaN(p)) throw new ValidationError('percent 模式下 percent 必须为数字');
      if (p < -100) throw new ValidationError('percent 不能小于 -100');
    }

    const where = {};
    if (userRole === 'agent') where.created_by = userId;
    if (Array.isArray(ids) && ids.length > 0) where.id = { [Op.in]: ids };
    if (tech_field) where.tech_field = { [Op.like]: `%${tech_field}%` };
    if (status) where.status = status;
    // 没有任何筛选条件时，默认只改在库的（安全防护）
    if (!ids && !tech_field && !status) where.status = 'in_stock';

    const targets = await PatentInventory.findAll({ where });
    if (targets.length === 0) {
      return { affected: 0, details: [] };
    }

    const changeDate = data.change_date || new Date().toISOString().slice(0, 10);
    const details = [];

    await sequelize.transaction(async (t) => {
      for (const inv of targets) {
        const oldPrice = parseFloat(inv.current_price) || 0;
        let newPrice;
        if (mode === 'fixed') {
          newPrice = parseFloat(data.new_price);
        } else {
          newPrice = parseFloat((oldPrice * (1 + parseFloat(data.percent) / 100)).toFixed(2));
          if (newPrice < 0) newPrice = 0;
        }

        await inv.update({ current_price: newPrice }, { transaction: t });
        await PatentPriceHistory.create({
          inventory_id: inv.id,
          old_price: oldPrice,
          new_price: newPrice,
          change_date: changeDate,
          reason: reason || `批量调价(${mode})`,
          created_by: userId
        }, { transaction: t });

        details.push({
          id: inv.id,
          patent_no: inv.patent_no,
          old_price: oldPrice,
          new_price: newPrice
        });
      }
    });

    return { affected: details.length, details };
  }

  /**
   * 添加年费记录（事务内重算 total_maintain_cost + next_fee_deadline）
   *
   * @param {number} inventoryId
   * @param {{fee_type?, amount, fee_date, deadline_date?, payment_id?, remark?}} data
   */
  async addAnnualFee(inventoryId, data, userId, userRole) {
    const inv = await PatentInventory.findByPk(inventoryId);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权对该库存添加年费');
    }

    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('金额必须大于0');
    }
    if (!data.fee_date) {
      throw new ValidationError('请选择缴费日期');
    }

    const fee = await sequelize.transaction(async (t) => {
      const created = await PatentAnnualFee.create({
        inventory_id: inventoryId,
        fee_type: data.fee_type || 'annual',
        amount: parseFloat(data.amount),
        fee_date: data.fee_date,
        deadline_date: data.deadline_date || null,
        payment_id: data.payment_id || null,
        remark: data.remark || null,
        created_by: userId
      }, { transaction: t });

      await this._refreshMaintainAggregates(inventoryId, t);

      return created;
    });

    return fee;
  }

  /**
   * 删除年费记录（事务内回算）
   */
  async deleteAnnualFee(inventoryId, feeId, userId, userRole) {
    const inv = await PatentInventory.findByPk(inventoryId);
    if (!inv) throw new NotFoundError('库存记录不存在');

    if (userRole === 'agent' && inv.created_by !== userId) {
      throw new ValidationError('无权删除该年费记录');
    }

    const fee = await PatentAnnualFee.findOne({
      where: { id: feeId, inventory_id: inventoryId }
    });
    if (!fee) throw new NotFoundError('年费记录不存在');

    await sequelize.transaction(async (t) => {
      await fee.destroy({ transaction: t });
      await this._refreshMaintainAggregates(inventoryId, t);
    });

    return { id: feeId };
  }

  /**
   * 库存总览统计
   *
   * 返回：
   *   - total_count     库存总数
   *   - by_status       各状态分布
   *   - total_purchase  采购成本总和
   *   - total_maintain  维持成本总和
   *   - total_value     在库专利现价总和
   *   - estimate_profit 估算利润（在库 current_price - 在库 purchase_price - 在库 total_maintain_cost）
   *   - avg_stock_age   在库专利平均库龄（天）
   */
  async getOverview() {
    // 各状态数量
    const statusRows = await sequelize.query(
      `SELECT status, COUNT(*) AS count FROM patent_inventory GROUP BY status`,
      { type: QueryTypes.SELECT }
    );
    const byStatus = { in_stock: 0, sold: 0, abandoned: 0, transferring: 0 };
    statusRows.forEach(r => { if (byStatus[r.status] !== undefined) byStatus[r.status] = parseInt(r.count, 10); });

    // 聚合金额（所有记录）
    const [agg] = await sequelize.query(
      `SELECT
         COUNT(*) AS total_count,
         COALESCE(SUM(purchase_price), 0) AS total_purchase,
         COALESCE(SUM(total_maintain_cost), 0) AS total_maintain
       FROM patent_inventory`,
      { type: QueryTypes.SELECT }
    );

    // 在库专利的统计
    const [stockAgg] = await sequelize.query(
      `SELECT
         COUNT(*) AS stock_count,
         COALESCE(SUM(current_price), 0) AS total_value,
         COALESCE(SUM(current_price - purchase_price - total_maintain_cost), 0) AS estimate_profit,
         COALESCE(AVG(DATEDIFF(NOW(), stock_in_date)), 0) AS avg_age
       FROM patent_inventory
       WHERE status = 'in_stock' AND stock_in_date IS NOT NULL`,
      { type: QueryTypes.SELECT }
    );

    return {
      total_count: parseInt(agg.total_count, 10),
      by_status: byStatus,
      total_purchase: parseFloat(parseFloat(agg.total_purchase).toFixed(2)),
      total_maintain: parseFloat(parseFloat(agg.total_maintain).toFixed(2)),
      stock_count: parseInt(stockAgg.stock_count, 10),
      total_value: parseFloat(parseFloat(stockAgg.total_value).toFixed(2)),
      estimate_profit: parseFloat(parseFloat(stockAgg.estimate_profit).toFixed(2)),
      avg_stock_age: Math.round(parseFloat(stockAgg.avg_age) || 0)
    };
  }

  /**
   * 即将到期年费查询
   *
   * @param {Object} query
   * @param {number} [query.days=60] 未来多少天内到期
   * @returns {Promise<Array>}
   */
  async getExpiring(query) {
    const days = parseInt(query?.days, 10) || 60;

    // 仅查在库 + next_fee_deadline 在 [today, today+days] 区间
    const sql = `
      SELECT
        id, patent_no, patent_name, tech_field,
        next_fee_deadline, current_price, total_maintain_cost,
        stock_in_date, DATEDIFF(next_fee_deadline, CURDATE()) AS days_left
      FROM patent_inventory
      WHERE status = 'in_stock'
        AND next_fee_deadline IS NOT NULL
        AND next_fee_deadline >= CURDATE()
        AND next_fee_deadline <= DATE_ADD(CURDATE(), INTERVAL :days DAY)
      ORDER BY next_fee_deadline ASC
    `;

    const rows = await sequelize.query(sql, {
      replacements: { days },
      type: QueryTypes.SELECT
    });

    return rows.map(r => ({
      id: r.id,
      patent_no: r.patent_no,
      patent_name: r.patent_name,
      tech_field: r.tech_field,
      next_fee_deadline: r.next_fee_deadline,
      days_left: parseInt(r.days_left, 10),
      current_price: parseFloat(r.current_price || 0),
      total_maintain_cost: parseFloat(r.total_maintain_cost || 0)
    }));
  }

  // ==================== 私有工具 ====================

  /**
   * 【私有】附加派生字段：stock_age_days / estimate_profit
   *
   * @param {PatentInventory} inv - Sequelize 实例
   * @returns {Object} 附加字段后的纯对象
   */
  _attachDerivedFields(inv) {
    const obj = typeof inv.toJSON === 'function' ? inv.toJSON() : { ...inv };

    // 库龄：依赖 stock_in_date
    if (obj.stock_in_date) {
      const inDate = new Date(obj.stock_in_date).getTime();
      const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
      obj.stock_age_days = Math.max(0, Math.round((today - inDate) / (24 * 3600 * 1000)));
    } else {
      obj.stock_age_days = null;
    }

    // 利润预估（在库才有意义，其他状态也给出数字便于比较）
    const cp = parseFloat(obj.current_price) || 0;
    const pp = parseFloat(obj.purchase_price) || 0;
    const mc = parseFloat(obj.total_maintain_cost) || 0;
    obj.estimate_profit = parseFloat((cp - pp - mc).toFixed(2));

    return obj;
  }

  /**
   * 【私有】重算 total_maintain_cost 和 next_fee_deadline
   *
   * 触发时机：新增/删除年费记录
   *
   * 规则：
   *   - total_maintain_cost = SUM(annual_fees.amount)
   *   - next_fee_deadline   = MAX(annual_fees.deadline_date)
   *     （取最晚一次能维持到的日期；若无任何 deadline，置 null）
   */
  async _refreshMaintainAggregates(inventoryId, transaction) {
    const [row] = await sequelize.query(
      `SELECT
         COALESCE(SUM(amount), 0) AS total,
         MAX(deadline_date) AS deadline
       FROM patent_annual_fees
       WHERE inventory_id = ?`,
      {
        replacements: [inventoryId],
        type: QueryTypes.SELECT,
        transaction
      }
    );

    const total = parseFloat(parseFloat(row.total || 0).toFixed(2));
    const deadline = row.deadline || null;

    await PatentInventory.update(
      { total_maintain_cost: total, next_fee_deadline: deadline },
      { where: { id: inventoryId }, transaction }
    );
  }
}

module.exports = new InventoryService();
