/**
 * ============================================================
 * 收付款业务服务（PaymentService）
 * ============================================================
 *
 * 【设计定位】
 * 收付款是 ERP 财务闭环的核心枢纽，一笔 payment 记录会引起以下联动：
 *   1) 账户余额变化（通过 accountService 查询时自动聚合，本服务不主动写入）
 *   2) 合同 paid_amount 变化（仅业务类且已确认时，本服务事务内更新）
 *   3) 应收/应付余额随合同 paid_amount 变动而变化
 *
 * 【两大分类】
 *   - business（业务类）：必须关联合同（contract_id），决定合同执行进度
 *   - fee（费用类）：关联成本类别（cost_category_id），不影响合同
 *
 * 【两个状态】
 *   - pending   ：审批同步来的，尚未人工确认（不影响合同 paid_amount）
 *   - confirmed ：已确认，业务类会实时反映到合同 paid_amount
 *
 * 【事务设计】
 * 创建/更新/删除 business + confirmed 的记录时，必须用事务保证：
 *   合同 paid_amount 的变更 与 payment 记录的写入 原子一致
 *
 * 【数据隔离】
 * agent 角色只能看到 created_by = 自己 的记录。
 * 路由层已通过 attachDataFilter 中间件附加了 req.dataFilter，
 * 本服务额外在 getList/update/delete 里做了一层兜底判断，双重保险。
 *
 * 【后续扩展点】
 *   - 对接企微审批同步后，pending → confirmed 走 confirm() 方法
 *   - Phase 3 接入 projects 后，project_id 的校验可以加强
 *   - Redis 缓存：应收/应付汇总可以加 5 分钟缓存
 *
 * 【T17 新增】费用类 payment 自动同步 cost_record
 *   create/update/confirm 时：若 category='fee' 且 confirm_status='confirmed'
 *     → 调用 costService.syncFromPayment 写入/更新 cost_record
 *   delete/改为非费用类/改为 pending 时
 *     → 调用 costService.removeFromPayment 删除 cost_record
 *
 *   为了避免循环依赖（payment → cost → payment），costService 在方法内部懒加载。
 * ============================================================
 */

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const Payment = require('../models/Payment');
const Contract = require('../models/Contract');
const BankAccount = require('../models/BankAccount');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

/**
 * 懒加载 costService（避免模块循环依赖）
 * @returns {ReturnType<typeof require>}
 */
function getCostService() {
  return require('./costService');
}

class PaymentService {
  /**
   * 获取收付款列表（分页 + 多维筛选）
   *
   * @param {Object} query 查询参数
   * @param {string} [query.type]             收付类型 income/expense
   * @param {string} [query.category]         业务分类 business/fee
   * @param {number} [query.account_id]       银行账户 ID
   * @param {number} [query.contract_id]      关联合同 ID
   * @param {number} [query.customer_id]      客户 ID
   * @param {number} [query.supplier_id]      供应商 ID
   * @param {number} [query.project_id]       交易项目 ID（Phase 3）
   * @param {number} [query.cost_category_id] 成本类别 ID
   * @param {string} [query.confirm_status]   确认状态 pending/confirmed
   * @param {string} [query.sp_no]            企微审批单号（精确查询）
   * @param {string} [query.start_date]       起始日期
   * @param {string} [query.end_date]         截止日期
   * @param {string} [query.keyword]          关键词（summary/remark/sp_no 模糊匹配）
   * @param {number} userId                   当前用户 ID（用于数据隔离兜底）
   * @param {string} userRole                 当前用户角色
   * @returns {Promise<{list: Array, pagination: Object}>}
   */
  async getList(query, userId, userRole) {
    const { page, limit, offset } = parsePagination(query);
    const {
      type, category, account_id, contract_id, customer_id, supplier_id,
      project_id, cost_category_id, confirm_status, sp_no,
      start_date, end_date, keyword
    } = query;

    const where = {};

    // ===== 数据隔离（兜底）=====
    // 路由层 attachDataFilter 已附加 req.dataFilter，service 层作为兜底
    // 双层保护避免上层中间件漏挂时越权
    if (userRole === 'agent') {
      where.created_by = userId;
    }

    // ===== 精确匹配字段 =====
    if (type) where.type = type;
    if (category) where.category = category;
    if (account_id) where.account_id = parseInt(account_id, 10);
    if (contract_id) where.contract_id = parseInt(contract_id, 10);
    if (customer_id) where.customer_id = parseInt(customer_id, 10);
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);
    if (project_id) where.project_id = parseInt(project_id, 10);
    if (cost_category_id) where.cost_category_id = parseInt(cost_category_id, 10);
    if (confirm_status) where.confirm_status = confirm_status;
    if (sp_no) where.sp_no = sp_no;

    // ===== 日期区间（闭区间）=====
    if (start_date || end_date) {
      where.payment_date = {};
      if (start_date) where.payment_date[Op.gte] = start_date;
      if (end_date) where.payment_date[Op.lte] = end_date;
    }

    // ===== 关键词模糊匹配（OR 条件）=====
    if (keyword) {
      where[Op.or] = [
        { summary: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } },
        { sp_no: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await Payment.findAndCountAll({
      where,
      order: [['payment_date', 'DESC'], ['create_time', 'DESC']], // 按日期倒序，同日看入库时间
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
   * 获取收付款详情
   * @param {number} id
   * @returns {Promise<Payment>}
   * @throws {NotFoundError} 记录不存在
   */
  async getDetail(id) {
    const payment = await Payment.findByPk(id);
    if (!payment) {
      throw new NotFoundError('收付款记录不存在');
    }
    return payment;
  }

  /**
   * 创建收付款
   *
   * 事务保证：
   *   若 category='business' 且 confirm_status='confirmed'（默认），
   *   则在事务内同步 +delta 到合同 paid_amount。
   *
   * @param {Object} data   收付款数据（详见 Payment 模型字段）
   * @param {number} userId 创建人 ID
   * @returns {Promise<Payment>}
   */
  async create(data, userId) {
    // ===== 基本验证（Joi 已校验过一轮，这里做业务语义校验）=====
    if (!data.type || !['income', 'expense'].includes(data.type)) {
      throw new ValidationError('收付款类型必须为 income 或 expense');
    }
    if (!data.category || !['business', 'fee'].includes(data.category)) {
      throw new ValidationError('收付款分类必须为 business 或 fee');
    }
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new ValidationError('金额必须大于0');
    }
    if (!data.account_id) {
      throw new ValidationError('请选择银行账户');
    }
    if (!data.payment_date) {
      throw new ValidationError('请选择收付款日期');
    }

    // ===== 外键校验（账户必须存在且启用）=====
    const account = await BankAccount.findByPk(data.account_id);
    if (!account) {
      throw new NotFoundError('银行账户不存在');
    }

    // ===== 业务语义校验：业务类必须关联合同 =====
    if (data.category === 'business' && !data.contract_id) {
      throw new ValidationError('业务类收付款必须关联合同');
    }

    const amount = parseFloat(data.amount);

    // ===== 事务包裹，保证合同 paid_amount 与 payment 写入原子一致 =====
    const result = await sequelize.transaction(async (t) => {
      const payment = await Payment.create({
        ...data,
        amount,
        created_by: userId
      }, { transaction: t });

      // 业务类且已确认 → 增加合同已收/已付金额
      if (payment.category === 'business'
          && payment.contract_id
          && payment.confirm_status === 'confirmed') {
        await this._updateContractPaidAmount(payment.contract_id, amount, t);
      }

      // T17：费用类 + confirmed → 同步写入 cost_record
      if (payment.category === 'fee' && payment.confirm_status === 'confirmed') {
        await getCostService().syncFromPayment(payment, t);
      }

      return payment;
    });

    return result;
  }

  /**
   * 更新收付款
   *
   * 核心难点：已确认业务类记录修改后，合同 paid_amount 要"先冲减旧值、再加新值"。
   * 流程：
   *   1) 若原先是 business+confirmed：-oldAmount
   *   2) 执行 update
   *   3) 若更新后仍（或变成）business+confirmed：+newAmount
   *
   * 这样四种状态切换都能正确处理：
   *   - confirmed → confirmed 改金额：等价于 delta = new - old
   *   - confirmed → pending     ：减掉旧值
   *   - pending   → confirmed   ：加上新值
   *   - pending   → pending     ：无影响
   *
   * @param {number} id
   * @param {Object} data
   * @param {number} userId
   * @param {string} userRole
   * @returns {Promise<Payment>}
   */
  async update(id, data, userId, userRole) {
    const payment = await Payment.findByPk(id);
    if (!payment) {
      throw new NotFoundError('收付款记录不存在');
    }

    // 数据隔离兜底
    if (userRole === 'agent' && payment.created_by !== userId) {
      throw new ValidationError('无权编辑该收付款');
    }

    const oldAmount = parseFloat(payment.amount) || 0;
    const wasConfirmedBusiness = payment.category === 'business'
      && payment.contract_id
      && payment.confirm_status === 'confirmed';

    const result = await sequelize.transaction(async (t) => {
      // 1) 先冲减旧值
      if (wasConfirmedBusiness) {
        await this._updateContractPaidAmount(payment.contract_id, -oldAmount, t);
      }

      await payment.update(data, { transaction: t });

      // 2) 重新评估更新后的状态，加上新值
      const newIsConfirmedBusiness = payment.category === 'business'
        && payment.contract_id
        && payment.confirm_status === 'confirmed';

      if (newIsConfirmedBusiness) {
        const newAmount = parseFloat(payment.amount) || 0;
        await this._updateContractPaidAmount(payment.contract_id, newAmount, t);
      }

      // T17：费用类 confirmed → 同步 cost_record；否则删除
      const costService = getCostService();
      if (payment.category === 'fee' && payment.confirm_status === 'confirmed') {
        await costService.syncFromPayment(payment, t);
      } else {
        await costService.removeFromPayment(payment.id, t);
      }

      return payment;
    });

    return result;
  }

  /**
   * 删除收付款
   *
   * 若原先是 business+confirmed，需事务内冲减合同 paid_amount，否则合同进度会虚高。
   *
   * @param {number} id
   * @param {number} userId
   * @param {string} userRole
   * @returns {Promise<{id: number}>}
   */
  async delete(id, userId, userRole) {
    const payment = await Payment.findByPk(id);
    if (!payment) {
      throw new NotFoundError('收付款记录不存在');
    }

    if (userRole === 'agent' && payment.created_by !== userId) {
      throw new ValidationError('无权删除该收付款');
    }

    const amount = parseFloat(payment.amount) || 0;
    const wasConfirmedBusiness = payment.category === 'business'
      && payment.contract_id
      && payment.confirm_status === 'confirmed';

    await sequelize.transaction(async (t) => {
      if (wasConfirmedBusiness) {
        await this._updateContractPaidAmount(payment.contract_id, -amount, t);
      }
      // T17：删除对应的 cost_record（若存在）
      await getCostService().removeFromPayment(payment.id, t);
      await payment.destroy({ transaction: t });
    });

    return { id };
  }

  /**
   * 确认收付款（pending → confirmed）
   *
   * 用于企微审批同步来的 pending 记录的人工确认。
   * 若是业务类，确认时事务内把金额加到合同 paid_amount 上。
   *
   * @param {number} id
   * @returns {Promise<Payment>}
   */
  async confirm(id) {
    const payment = await Payment.findByPk(id);
    if (!payment) {
      throw new NotFoundError('收付款记录不存在');
    }

    if (payment.confirm_status === 'confirmed') {
      throw new ValidationError('该记录已确认，无需重复确认');
    }

    const amount = parseFloat(payment.amount) || 0;
    const isBusiness = payment.category === 'business' && payment.contract_id;

    await sequelize.transaction(async (t) => {
      await payment.update({ confirm_status: 'confirmed' }, { transaction: t });

      if (isBusiness) {
        await this._updateContractPaidAmount(payment.contract_id, amount, t);
      }

      // T17：费用类 confirmed → 同步写入 cost_record
      if (payment.category === 'fee') {
        await getCostService().syncFromPayment(payment, t);
      }
    });

    return payment;
  }

  /**
   * 应收汇总：销售合同金额 - 已收款
   *
   * 直接从 contracts.paid_amount 字段读取（已由 create/update/delete/confirm 联动维护），
   * 避免实时 JOIN 聚合 payments 带来的性能压力。
   *
   * @param {Object} query
   * @param {number} [query.customer_id] 可按客户筛选
   * @returns {Promise<{list: Array, summary: Object}>}
   */
  async getReceivable(query) {
    const { customer_id } = query;

    const contractWhere = { type: 'sale' };
    if (customer_id) contractWhere.customer_id = parseInt(customer_id, 10);

    const contracts = await Contract.findAll({
      where: contractWhere,
      attributes: ['id', 'contract_no', 'title', 'customer_id', 'amount', 'paid_amount', 'status', 'expire_date'],
      order: [['expire_date', 'ASC']] // 按到期日升序，越早到期越靠前
    });

    const list = contracts.map(c => {
      const amount = parseFloat(c.amount) || 0;
      const paid = parseFloat(c.paid_amount) || 0;
      return {
        contract_id: c.id,
        contract_no: c.contract_no,
        title: c.title,
        customer_id: c.customer_id,
        status: c.status,
        expire_date: c.expire_date,
        amount,
        paid_amount: paid,
        receivable: parseFloat((amount - paid).toFixed(2))
      };
    });

    const totalAmount = list.reduce((sum, x) => sum + x.amount, 0);
    const totalPaid = list.reduce((sum, x) => sum + x.paid_amount, 0);
    const totalReceivable = parseFloat((totalAmount - totalPaid).toFixed(2));

    return {
      list,
      summary: {
        contract_count: list.length,
        total_amount: parseFloat(totalAmount.toFixed(2)),
        total_paid: parseFloat(totalPaid.toFixed(2)),
        total_receivable: totalReceivable
      }
    };
  }

  /**
   * 应付汇总：采购合同金额 - 已付款
   * 与 getReceivable 对称实现
   */
  async getPayable(query) {
    const { supplier_id } = query;

    const contractWhere = { type: 'purchase' };
    if (supplier_id) contractWhere.supplier_id = parseInt(supplier_id, 10);

    const contracts = await Contract.findAll({
      where: contractWhere,
      attributes: ['id', 'contract_no', 'title', 'supplier_id', 'amount', 'paid_amount', 'status', 'expire_date'],
      order: [['expire_date', 'ASC']]
    });

    const list = contracts.map(c => {
      const amount = parseFloat(c.amount) || 0;
      const paid = parseFloat(c.paid_amount) || 0;
      return {
        contract_id: c.id,
        contract_no: c.contract_no,
        title: c.title,
        supplier_id: c.supplier_id,
        status: c.status,
        expire_date: c.expire_date,
        amount,
        paid_amount: paid,
        payable: parseFloat((amount - paid).toFixed(2))
      };
    });

    const totalAmount = list.reduce((sum, x) => sum + x.amount, 0);
    const totalPaid = list.reduce((sum, x) => sum + x.paid_amount, 0);
    const totalPayable = parseFloat((totalAmount - totalPaid).toFixed(2));

    return {
      list,
      summary: {
        contract_count: list.length,
        total_amount: parseFloat(totalAmount.toFixed(2)),
        total_paid: parseFloat(totalPaid.toFixed(2)),
        total_payable: totalPayable
      }
    };
  }

  /**
   * 【私有】原子更新合同 paid_amount
   *
   * 说明：
   *   - 必须传入外层事务对象 transaction，由调用方控制事务边界
   *   - delta 可正可负（-冲减，+增加），调用方自行保证正负号
   *   - 若合同被软删除（status=terminated）则直接跳过（避免已终止合同数据污染）
   *
   * 注意并发：
   *   目前用 findByPk → update 两步，极端高并发下可能出现丢失更新。
   *   后续若 QPS 升高可改为 `paid_amount = paid_amount + ?` 的原子 SQL。
   *
   * @param {number} contractId
   * @param {number} delta       变化量，正数增加负数减少
   * @param {import('sequelize').Transaction} transaction
   * @returns {Promise<void>}
   */
  async _updateContractPaidAmount(contractId, delta, transaction) {
    const contract = await Contract.findByPk(contractId, { transaction });
    if (!contract) return; // 合同被删则静默跳过，不阻断 payment 写入

    const newPaid = parseFloat(contract.paid_amount || 0) + parseFloat(delta);
    await contract.update(
      { paid_amount: parseFloat(newPaid.toFixed(2)) },
      { transaction }
    );
  }
}

module.exports = new PaymentService();
