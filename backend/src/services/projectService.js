/**
 * ============================================================
 * 交易项目业务服务（ProjectService）
 * ============================================================
 *
 * 【核心职责】
 *   1) CRUD：创建/查询/编辑/删除项目
 *   2) 聚合刷新：从 contracts / payments / patent_annual_fees 汇总
 *      写入冗余字段（sale/purchase/tax/maintain/gross_profit）
 *   3) 利润明细：getProfitDetail 返回完整的资金流向（Sankey 图数据源）
 *   4) 状态自动流转：所有销售合同 completed → 项目 completed
 *
 * 【聚合公式】
 *   sale_amount     = SUM(contracts.amount WHERE project_id=X AND type='sale')
 *   purchase_amount = SUM(contracts.amount WHERE project_id=X AND type='purchase')
 *   tax_cost        = SUM(purchase.amount × supplier.tax_rate / 100)
 *                     采购合同关联的供应商税点成本
 *   maintain_cost   = SUM(patent_annual_fees.amount
 *                         WHERE inventory.project_id = X)
 *   gross_profit    = sale_amount - purchase_amount - tax_cost - maintain_cost
 *
 * 【何时聚合】
 *   - 创建项目后立即聚合一次
 *   - 显式调用 POST /:id/refresh
 *   - TODO: 后续可在 Contract/Payment/AnnualFee 的 service 里调用
 *     （当前为了降耦合先不主动联动，避免业务层依赖倒转）
 *
 * 【数据隔离】
 *   agent 只能看 created_by=自己 或 owner_id=自己 的项目（OR）
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Project = require('../models/Project');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const PatentInventory = require('../models/PatentInventory');
const PatentAnnualFee = require('../models/PatentAnnualFee');
const BankAccount = require('../models/BankAccount');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

class ProjectService {
  /**
   * 获取项目列表
   *
   * @param {Object} query
   * @param {string} [query.status]
   * @param {number} [query.customer_id]
   * @param {number} [query.supplier_id]
   * @param {string} [query.keyword]   name/patent_no/remark 模糊
   * @param {string} [query.sort]      profit | sale | create（默认 create）
   * @param {string} [query.order]     asc/desc（默认 desc）
   */
  async getList(query, userId, userRole) {
    const { page, limit, offset } = parsePagination(query);
    const { status, customer_id, supplier_id, keyword, sort, order } = query;

    const where = {};

    // ===== 数据隔离：agent 只看 created_by=自己 OR owner_id=自己 =====
    if (userRole === 'agent') {
      where[Op.or] = [
        { created_by: userId },
        { owner_id: userId }
      ];
    }

    if (status) where.status = status;
    if (customer_id) where.customer_id = parseInt(customer_id, 10);
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);

    if (keyword) {
      const kwOr = [
        { name: { [Op.like]: `%${keyword}%` } },
        { patent_no: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } }
      ];
      // keyword 和数据隔离的 OR 混用时，用 AND 包装
      if (where[Op.or]) {
        where[Op.and] = [
          { [Op.or]: where[Op.or] },
          { [Op.or]: kwOr }
        ];
        delete where[Op.or];
      } else {
        where[Op.or] = kwOr;
      }
    }

    // 排序
    const ord = (order === 'asc') ? 'ASC' : 'DESC';
    let orderClause = [['create_time', 'DESC']];
    if (sort === 'profit') orderClause = [['gross_profit', ord]];
    else if (sort === 'sale') orderClause = [['sale_amount', ord]];

    const data = await Project.findAndCountAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: orderClause,
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
   * 获取项目详情（含关联合同/收付款/库存）
   */
  async getDetail(id) {
    const project = await Project.findByPk(id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        {
          model: Contract,
          as: 'contracts',
          attributes: [
            'id', 'contract_no', 'type', 'title', 'amount', 'paid_amount',
            'status', 'sign_date', 'expire_date'
          ],
          separate: true,
          order: [['type', 'ASC'], ['sign_date', 'DESC']]
        },
        {
          model: Payment,
          as: 'payments',
          attributes: [
            'id', 'type', 'category', 'amount', 'payment_date',
            'contract_id', 'account_id', 'summary', 'confirm_status'
          ],
          include: [
            { model: BankAccount, as: 'account', attributes: ['id', 'name'] }
          ],
          separate: true,
          order: [['payment_date', 'DESC']]
        },
        {
          model: PatentInventory,
          as: 'inventories',
          attributes: [
            'id', 'patent_no', 'patent_name', 'status',
            'purchase_price', 'current_price', 'total_maintain_cost',
            'next_fee_deadline'
          ],
          separate: true
        }
      ]
    });

    if (!project) throw new NotFoundError('项目不存在');
    return project;
  }

  /**
   * 创建项目
   */
  async create(data, userId) {
    if (!data.name) throw new ValidationError('项目名称不能为空');

    if (data.customer_id) {
      const c = await Customer.findByPk(data.customer_id);
      if (!c) throw new NotFoundError('客户不存在');
    }
    if (data.supplier_id) {
      const s = await Supplier.findByPk(data.supplier_id);
      if (!s) throw new NotFoundError('供应商不存在');
    }

    const project = await Project.create({
      ...data,
      status: data.status || 'active',
      created_by: userId
    });

    // 立即聚合一次（此时通常无关联，数值都是 0）
    await this.refreshAggregates(project.id);

    return await Project.findByPk(project.id);
  }

  /**
   * 更新项目基本信息（不接受聚合字段）
   */
  async update(id, data, userId, userRole) {
    const project = await Project.findByPk(id);
    if (!project) throw new NotFoundError('项目不存在');

    this._ensureWritable(project, userId, userRole);

    // 剥离系统管控字段
    const safe = { ...data };
    ['sale_amount', 'purchase_amount', 'tax_cost', 'maintain_cost', 'gross_profit'].forEach(k => delete safe[k]);

    await project.update(safe);
    return project;
  }

  /**
   * 变更状态（active → completed / cancelled）
   */
  async changeStatus(id, status, userId, userRole) {
    if (!['active', 'completed', 'cancelled'].includes(status)) {
      throw new ValidationError('状态值非法');
    }
    const project = await Project.findByPk(id);
    if (!project) throw new NotFoundError('项目不存在');
    this._ensureWritable(project, userId, userRole);

    await project.update({ status });
    return project;
  }

  /**
   * 删除项目
   *
   * 规则：
   *   - 仅解除关联（把关联 Contract/Payment/Inventory 的 project_id 置 null），
   *     不删除原始单据（单据应独立存在，避免数据丢失）
   */
  async delete(id, userId, userRole) {
    const project = await Project.findByPk(id);
    if (!project) throw new NotFoundError('项目不存在');
    this._ensureWritable(project, userId, userRole);

    await sequelize.transaction(async (t) => {
      // 解除合同关联
      await Contract.update(
        { project_id: null },
        { where: { project_id: id }, transaction: t }
      );
      // 解除收付款关联
      await Payment.update(
        { project_id: null },
        { where: { project_id: id }, transaction: t }
      );
      // 解除专利库存关联
      await PatentInventory.update(
        { project_id: null },
        { where: { project_id: id }, transaction: t }
      );
      await project.destroy({ transaction: t });
    });

    return { id };
  }

  /**
   * 【只读】从关联数据实时计算聚合值（不写库）
   * 供 refreshAggregates 落库与 getProfitDetail 只读展示复用。
   *
   * @param {number} id 项目 ID
   * @returns {Promise<{saleAmount:number,purchaseAmount:number,taxCost:number,maintainCost:number,grossProfit:number}>}
   */
  async _computeAggregates(id) {
    // 销售合同金额
    const [saleRow] = await sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM contracts
       WHERE project_id = :id AND type = 'sale'`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    const saleAmount = parseFloat(parseFloat(saleRow.total || 0).toFixed(2));

    // 采购合同金额（用于计算 tax_cost）
    const purchaseRows = await sequelize.query(
      `SELECT c.id, c.amount, s.tax_rate
       FROM contracts c
       LEFT JOIN suppliers s ON s.id = c.supplier_id
       WHERE c.project_id = :id AND c.type = 'purchase'`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    let purchaseAmount = 0;
    let taxCost = 0;
    for (const r of purchaseRows) {
      const amt = parseFloat(r.amount) || 0;
      const rate = parseFloat(r.tax_rate) || 0;
      purchaseAmount += amt;
      taxCost += amt * rate / 100;
    }
    purchaseAmount = parseFloat(purchaseAmount.toFixed(2));
    taxCost = parseFloat(taxCost.toFixed(2));

    // 维持成本（本项目所有专利的年费总和）
    const [maintainRow] = await sequelize.query(
      `SELECT COALESCE(SUM(f.amount), 0) AS total
       FROM patent_annual_fees f
       JOIN patent_inventory i ON i.id = f.inventory_id
       WHERE i.project_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    const maintainCost = parseFloat(parseFloat(maintainRow.total || 0).toFixed(2));

    // 毛利润
    const grossProfit = parseFloat((saleAmount - purchaseAmount - taxCost - maintainCost).toFixed(2));

    return { saleAmount, purchaseAmount, taxCost, maintainCost, grossProfit };
  }

  /**
   * 聚合刷新：从关联数据重算所有冗余字段 + 自动判断状态流转
   *
   * @param {number} id 项目 ID
   * @returns {Promise<Project>} 刷新后的项目实例
   */
  async refreshAggregates(id) {
    const project = await Project.findByPk(id);
    if (!project) throw new NotFoundError('项目不存在');

    const { saleAmount, purchaseAmount, taxCost, maintainCost, grossProfit } =
      await this._computeAggregates(id);

    // ===== 状态自动流转 =====
    // 规则：project.status === 'active' 且 至少有 1 个销售合同 且 所有销售合同均 completed → 项目 completed
    let nextStatus = project.status;
    if (project.status === 'active') {
      const saleCounts = await sequelize.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM contracts
         WHERE project_id = :id AND type = 'sale'`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      const total = parseInt(saleCounts[0].total, 10);
      const completed = parseInt(saleCounts[0].completed, 10);
      if (total > 0 && total === completed) {
        nextStatus = 'completed';
      }
    }

    await project.update({
      sale_amount: saleAmount,
      purchase_amount: purchaseAmount,
      tax_cost: taxCost,
      maintain_cost: maintainCost,
      gross_profit: grossProfit,
      status: nextStatus
    });

    return await Project.findByPk(id);
  }

  /**
   * 资金流向明细（Sankey 图数据源）
   *
   * 返回结构：
   * {
   *   summary: { sale_amount, purchase_amount, tax_cost, maintain_cost, gross_profit },
   *   flows: [
   *     { from: '销售收入', to: '采购', value: xxx },
   *     { from: '销售收入', to: '税点',  value: xxx },
   *     { from: '销售收入', to: '维持',  value: xxx },
   *     { from: '销售收入', to: '利润',  value: xxx }
   *   ],
   *   contracts: { sale: [...], purchase: [...] },
   *   maintain_fees: [...]   // 年费流水
   * }
   */
  async getProfitDetail(id) {
    const project = await Project.findByPk(id);
    if (!project) throw new NotFoundError('项目不存在');

    // 只读：实时计算聚合返回，不写库（落库由 refreshAggregates / 定时任务负责）
    const { saleAmount, purchaseAmount, taxCost, maintainCost, grossProfit } =
      await this._computeAggregates(id);

    // 关联合同
    const contracts = await Contract.findAll({
      where: { project_id: id },
      attributes: ['id', 'contract_no', 'type', 'title', 'amount', 'paid_amount', 'status'],
      order: [['type', 'ASC'], ['sign_date', 'DESC']]
    });

    // 维持费用明细
    const maintainFees = await sequelize.query(
      `SELECT f.id, f.fee_type, f.amount, f.fee_date, f.deadline_date,
              i.patent_no, i.patent_name
       FROM patent_annual_fees f
       JOIN patent_inventory i ON i.id = f.inventory_id
       WHERE i.project_id = :id
       ORDER BY f.fee_date DESC`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    // 资金流向数据
    // 注意：利润为负时 Sankey 图"利润"分支不绘（数值需 >= 0）
    const flows = [
      { from: '销售收入', to: '采购成本', value: purchaseAmount },
      { from: '销售收入', to: '税点成本', value: taxCost },
      { from: '销售收入', to: '维持成本', value: maintainCost },
      { from: '销售收入', to: grossProfit >= 0 ? '利润' : '亏损', value: Math.abs(grossProfit) }
    ].filter(f => f.value > 0);

    return {
      summary: {
        sale_amount: saleAmount,
        purchase_amount: purchaseAmount,
        tax_cost: taxCost,
        maintain_cost: maintainCost,
        gross_profit: grossProfit
      },
      flows,
      contracts: {
        sale: contracts.filter(c => c.type === 'sale'),
        purchase: contracts.filter(c => c.type === 'purchase')
      },
      maintain_fees: maintainFees.map(r => ({
        id: r.id,
        fee_type: r.fee_type,
        amount: parseFloat(r.amount),
        fee_date: r.fee_date,
        deadline_date: r.deadline_date,
        patent_no: r.patent_no,
        patent_name: r.patent_name
      }))
    };
  }

  /**
   * 项目总体利润汇总（用于 Dashboard 升级）
   *
   * @param {Object} query
   * @param {string} [query.start_date]  按 create_time 起
   * @param {string} [query.end_date]    按 create_time 止
   * @returns {Promise<Object>}
   */
  async getProfitSummary(query) {
    const { start_date, end_date } = query || {};

    const where = [];
    const replacements = {};

    if (start_date) {
      where.push('create_time >= :start_date');
      replacements.start_date = start_date;
    }
    if (end_date) {
      where.push('create_time <= :end_date');
      replacements.end_date = end_date;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [row] = await sequelize.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(sale_amount), 0) AS sale,
         COALESCE(SUM(purchase_amount), 0) AS purchase,
         COALESCE(SUM(tax_cost), 0) AS tax,
         COALESCE(SUM(maintain_cost), 0) AS maintain,
         COALESCE(SUM(gross_profit), 0) AS gross
       FROM projects
       ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );

    // 完成项目的汇总
    const [completedRow] = await sequelize.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(gross_profit), 0) AS gross
       FROM projects
       WHERE status = 'completed'
         ${start_date ? "AND create_time >= :start_date" : ''}
         ${end_date ? "AND create_time <= :end_date" : ''}`,
      { replacements, type: QueryTypes.SELECT }
    );

    return {
      all: {
        count: parseInt(row.count, 10),
        sale_amount: parseFloat(parseFloat(row.sale).toFixed(2)),
        purchase_amount: parseFloat(parseFloat(row.purchase).toFixed(2)),
        tax_cost: parseFloat(parseFloat(row.tax).toFixed(2)),
        maintain_cost: parseFloat(parseFloat(row.maintain).toFixed(2)),
        gross_profit: parseFloat(parseFloat(row.gross).toFixed(2))
      },
      completed: {
        count: parseInt(completedRow.count, 10),
        gross_profit: parseFloat(parseFloat(completedRow.gross).toFixed(2))
      }
    };
  }

  // ==================== 私有工具 ====================

  /**
   * 【私有】检查写权限（创建人或负责人）
   */
  _ensureWritable(project, userId, userRole) {
    if (userRole === 'agent') {
      const isOwner = project.owner_id === userId;
      const isCreator = project.created_by === userId;
      if (!isOwner && !isCreator) {
        throw new ValidationError('无权操作该项目');
      }
    }
  }
}

module.exports = new ProjectService();
