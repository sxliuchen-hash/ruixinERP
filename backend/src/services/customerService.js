const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const Customer = require('../models/Customer');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');

class CustomerService {
  /**
   * 获取客户列表（分页 + 关键词搜索）
   */
  async getList(query) {
    const { page, limit, offset } = parsePagination(query);
    const { keyword } = query;

    const where = {};
    if (keyword) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { contact_person: { [Op.like]: `%${keyword}%` } },
        { phone: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await Customer.findAndCountAll({
      where,
      order: [['create_time', 'DESC']],
      offset,
      limit
    });

    return buildPaginationResponse(data, page, limit);
  }

  /**
   * 获取客户详情（含往来账汇总统计）
   */
  async getDetail(id) {
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new NotFoundError('客户不存在');
    }

    // 获取往来账汇总
    const summary = await this._getTransactionSummary(id);

    return {
      ...customer.toJSON(),
      summary
    };
  }

  /**
   * 创建客户
   */
  async create(data, userId) {
    const customer = await Customer.create(data);
    return customer;
  }

  /**
   * 更新客户
   */
  async update(id, data) {
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new NotFoundError('客户不存在');
    }

    await customer.update(data);
    return customer;
  }

  /**
   * 删除客户（检查是否有关联合同）
   */
  async delete(id) {
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new NotFoundError('客户不存在');
    }

    // 检查是否有关联的合同
    try {
      const [result] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM contracts WHERE customer_id = ? AND status != 'terminated'`,
        { replacements: [id], type: QueryTypes.SELECT }
      );
      if (parseInt(result.cnt, 10) > 0) {
        throw new ValidationError('该客户存在未终止的合同，无法删除');
      }
    } catch (error) {
      // 如果是我们抛出的 ValidationError，继续抛出
      if (error instanceof ValidationError) throw error;
      // contracts 表不存在时忽略
    }

    await customer.destroy();
    return { id };
  }

  /**
   * 获取客户往来账明细
   * 包含：关联合同列表 + 收付款记录列表 + 汇总统计
   */
  async getTransactions(id, query = {}) {
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new NotFoundError('客户不存在');
    }

    const { page, limit, offset } = parsePagination(query);

    // 获取汇总统计
    const summary = await this._getTransactionSummary(id);

    // 获取关联合同列表
    let contracts = [];
    try {
      contracts = await sequelize.query(
        `SELECT id, contract_no, title, type, amount, paid_amount, sign_date, status, create_time
         FROM contracts 
         WHERE customer_id = ?
         ORDER BY create_time DESC
         LIMIT ? OFFSET ?`,
        { replacements: [id, limit, offset], type: QueryTypes.SELECT }
      );
    } catch (error) {
      // contracts 表不存在时返回空
    }

    // 获取收付款记录
    let payments = [];
    try {
      payments = await sequelize.query(
        `SELECT p.id, p.type, p.amount, p.payment_date, p.payment_method, p.summary,
                p.contract_id, c.contract_no, c.title AS contract_title
         FROM payments p
         LEFT JOIN contracts c ON p.contract_id = c.id
         WHERE p.customer_id = ?
         ORDER BY p.payment_date DESC
         LIMIT ? OFFSET ?`,
        { replacements: [id, limit, offset], type: QueryTypes.SELECT }
      );
    } catch (error) {
      // payments 表不存在时返回空
    }

    // 获取发票记录
    let invoices = [];
    try {
      invoices = await sequelize.query(
        `SELECT id, type, invoice_type, invoice_no, amount, tax_amount, total_amount, 
                invoice_date, status, contract_id
         FROM invoices 
         WHERE customer_id = ?
         ORDER BY invoice_date DESC
         LIMIT ? OFFSET ?`,
        { replacements: [id, limit, offset], type: QueryTypes.SELECT }
      );
    } catch (error) {
      // invoices 表不存在时返回空
    }

    return {
      customer,
      summary,
      contracts,
      payments,
      invoices
    };
  }

  /**
   * 内部方法：获取客户往来账汇总统计
   * @private
   */
  async _getTransactionSummary(id) {
    let contractCount = 0;
    let contractTotal = 0;
    let paidTotal = 0;
    let invoiceTotal = 0;

    // 查询合同数据
    try {
      const [contractResult] = await sequelize.query(
        `SELECT COUNT(*) AS contract_count, COALESCE(SUM(amount), 0) AS contract_total 
         FROM contracts WHERE customer_id = ?`,
        { replacements: [id], type: QueryTypes.SELECT }
      );
      contractCount = parseInt(contractResult.contract_count, 10) || 0;
      contractTotal = parseFloat(contractResult.contract_total) || 0;
    } catch (error) {
      // contracts 表不存在时返回 0
    }

    // 查询收款数据（income 类型）
    try {
      const [paymentResult] = await sequelize.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid_total 
         FROM payments WHERE customer_id = ? AND type = 'income'`,
        { replacements: [id], type: QueryTypes.SELECT }
      );
      paidTotal = parseFloat(paymentResult.paid_total) || 0;
    } catch (error) {
      // payments 表不存在时返回 0
    }

    // 查询已开票金额
    try {
      const [invoiceResult] = await sequelize.query(
        `SELECT COALESCE(SUM(total_amount), 0) AS invoice_total 
         FROM invoices WHERE customer_id = ? AND status != 'cancelled'`,
        { replacements: [id], type: QueryTypes.SELECT }
      );
      invoiceTotal = parseFloat(invoiceResult.invoice_total) || 0;
    } catch (error) {
      // invoices 表不存在时返回 0
    }

    const receivable = parseFloat((contractTotal - paidTotal).toFixed(2));

    return {
      contract_count: contractCount,
      contract_total: contractTotal,
      paid_total: paidTotal,
      receivable,
      invoice_total: invoiceTotal
    };
  }
}

module.exports = new CustomerService();
