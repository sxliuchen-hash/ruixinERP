const { Op } = require('sequelize');
const Invoice = require('../models/Invoice');
const Supplier = require('../models/Supplier');
const Customer = require('../models/Customer');
const Contract = require('../models/Contract');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

class InvoiceService {
  /**
   * 获取发票列表（分页 + 筛选）
   */
  async getList(query) {
    const { page, limit, offset } = parsePagination(query);
    const { type, status, contract_id, customer_id, supplier_id, keyword } = query;

    const where = {};

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    if (contract_id) {
      where.contract_id = parseInt(contract_id, 10);
    }
    if (customer_id) {
      where.customer_id = parseInt(customer_id, 10);
    }
    if (supplier_id) {
      where.supplier_id = parseInt(supplier_id, 10);
    }
    if (keyword) {
      where[Op.or] = [
        { invoice_no: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const data = await Invoice.findAndCountAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'tax_rate'] },
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no', 'title'] }
      ],
      order: [['create_time', 'DESC']],
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
   * 获取发票详情
   */
  async getDetail(id) {
    const invoice = await Invoice.findByPk(id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'contact_person', 'phone'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contact_person', 'phone', 'tax_rate'] },
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no', 'title', 'type', 'amount', 'status'] }
      ]
    });

    if (!invoice) {
      throw new NotFoundError('发票不存在');
    }

    return invoice;
  }

  /**
   * 创建发票
   * 进项发票自动根据供应商税率计算税额
   */
  async create(data, userId) {
    const amount = parseFloat(data.amount);
    let tax_amount = parseFloat(data.tax_amount) || 0;
    let total_amount = parseFloat(data.total_amount) || 0;

    // 进项发票：根据供应商税率自动计算税额
    if (data.type === 'input' && data.supplier_id) {
      const supplier = await Supplier.findByPk(data.supplier_id);
      if (supplier && supplier.tax_rate) {
        const taxRate = parseFloat(supplier.tax_rate);
        tax_amount = parseFloat((amount * taxRate / 100).toFixed(2));
        total_amount = parseFloat((amount + tax_amount).toFixed(2));
      } else {
        // 供应商无税率，使用用户提供的值或默认
        total_amount = parseFloat((amount + tax_amount).toFixed(2));
      }
    }

    // 销项发票：价税合计 = 金额 + 税额（用户提供税额）
    if (data.type === 'output') {
      total_amount = parseFloat((amount + tax_amount).toFixed(2));
    }

    const invoice = await Invoice.create({
      type: data.type,
      invoice_type: data.invoice_type,
      invoice_no: data.invoice_no || null,
      amount,
      tax_amount,
      total_amount,
      invoice_date: data.invoice_date || null,
      contract_id: data.contract_id || null,
      customer_id: data.customer_id || null,
      supplier_id: data.supplier_id || null,
      status: 'pending',
      sp_no: data.sp_no || null,
      remark: data.remark || null,
      created_by: userId
    });

    return invoice;
  }

  /**
   * 更新发票
   * 已开具或已作废的发票不允许修改
   */
  async update(id, data) {
    const invoice = await Invoice.findByPk(id);
    if (!invoice) {
      throw new NotFoundError('发票不存在');
    }

    // 已开具或已作废的发票不允许修改
    if (['issued', 'cancelled'].includes(invoice.status)) {
      throw new ValidationError('已开具或已作废的发票不允许修改');
    }

    // 如果修改了金额或供应商，重新计算税额
    const type = data.type || invoice.type;
    const supplierId = data.supplier_id !== undefined ? data.supplier_id : invoice.supplier_id;
    const amount = data.amount !== undefined ? parseFloat(data.amount) : parseFloat(invoice.amount);
    let tax_amount = data.tax_amount !== undefined ? parseFloat(data.tax_amount) : parseFloat(invoice.tax_amount) || 0;
    let total_amount;

    // 进项发票且有供应商：重新计算
    if (type === 'input' && supplierId && (data.amount !== undefined || data.supplier_id !== undefined)) {
      const supplier = await Supplier.findByPk(supplierId);
      if (supplier && supplier.tax_rate) {
        const taxRate = parseFloat(supplier.tax_rate);
        tax_amount = parseFloat((amount * taxRate / 100).toFixed(2));
      }
    }

    total_amount = parseFloat((amount + tax_amount).toFixed(2));

    const updateData = { ...data };
    if (data.amount !== undefined || data.supplier_id !== undefined || data.tax_amount !== undefined) {
      updateData.amount = amount;
      updateData.tax_amount = tax_amount;
      updateData.total_amount = total_amount;
    }

    await invoice.update(updateData);
    return invoice;
  }

  /**
   * 删除发票
   * 已开具的发票不允许删除，需先作废
   */
  async delete(id) {
    const invoice = await Invoice.findByPk(id);
    if (!invoice) {
      throw new NotFoundError('发票不存在');
    }

    // 已开具的发票不允许删除
    if (invoice.status === 'issued') {
      throw new ValidationError('已开具的发票不允许删除，请先作废');
    }

    await invoice.destroy();
    return { id };
  }

  /**
   * 更新发票状态
   * 状态转换规则：pending → issued → cancelled
   */
  async updateStatus(id, status) {
    const invoice = await Invoice.findByPk(id);
    if (!invoice) {
      throw new NotFoundError('发票不存在');
    }

    // 验证状态转换合法性
    const validTransitions = {
      pending: ['issued', 'cancelled'],
      issued: ['cancelled'],
      cancelled: []
    };

    const allowedNextStatuses = validTransitions[invoice.status] || [];
    if (!allowedNextStatuses.includes(status)) {
      throw new ValidationError(
        `不允许从 "${invoice.status}" 转换到 "${status}"，允许的目标状态: ${allowedNextStatuses.join(', ') || '无'}`
      );
    }

    await invoice.update({ status });
    return invoice;
  }
}

module.exports = new InvoiceService();
