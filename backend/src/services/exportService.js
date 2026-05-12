/**
 * ============================================================
 * 数据导出业务服务（ExportService）
 * ============================================================
 *
 * 职责：
 *   针对各业务模块提供 Excel 导出能力。
 *   接受与列表查询一致的筛选参数，然后用 excelHelper 生成二进制。
 *
 * 【支持的导出类型】
 *   payments      收付款明细
 *   contracts     合同列表
 *   inventory     专利库存
 *   invoices      发票列表
 *   expenses      报销明细
 *   projects      交易项目（含利润）
 *   costs         成本记录
 *
 * 【安全限制】
 *   - 最大导出 5000 条，防止全量拉取把数据库打爆
 *   - 使用与列表一致的筛选，保证用户看到的和导出的一致
 *
 * 【数据隔离】
 *   已在各 service 层 getList 内处理（agent 仅导出自己相关），
 *   exportService 调用时传入同样的 userId/userRole 即可。
 * ============================================================
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Payment = require('../models/Payment');
const Contract = require('../models/Contract');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const BankAccount = require('../models/BankAccount');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const PatentInventory = require('../models/PatentInventory');
const Project = require('../models/Project');
const CostRecord = require('../models/CostRecord');
const CostCategory = require('../models/CostCategory');
const { buildExcel, buildFilename } = require('../utils/excelHelper');

/** 单次导出最大条数（防拉爆） */
const MAX_EXPORT = 5000;

class ExportService {
  /**
   * 导出收付款明细
   */
  async exportPayments(query, userId, userRole) {
    const where = {};
    if (userRole === 'agent') where.created_by = userId;
    const {
      type, category, account_id, contract_id, customer_id, supplier_id,
      confirm_status, start_date, end_date, keyword
    } = query;

    if (type) where.type = type;
    if (category) where.category = category;
    if (account_id) where.account_id = parseInt(account_id, 10);
    if (contract_id) where.contract_id = parseInt(contract_id, 10);
    if (customer_id) where.customer_id = parseInt(customer_id, 10);
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);
    if (confirm_status) where.confirm_status = confirm_status;
    if (start_date || end_date) {
      where.payment_date = {};
      if (start_date) where.payment_date[Op.gte] = start_date;
      if (end_date) where.payment_date[Op.lte] = end_date;
    }
    if (keyword) {
      where[Op.or] = [
        { summary: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const rows = await Payment.findAll({
      where,
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name'] },
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no', 'title'] },
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['payment_date', 'DESC']],
      limit: MAX_EXPORT
    });

    const buffer = await buildExcel({
      title: '收付款明细',
      sheetName: '收付款',
      columns: [
        { header: '日期', key: 'payment_date', width: 12, type: 'date' },
        { header: '类型', key: 'type', width: 8, formatter: (v) => v === 'income' ? '收款' : '付款' },
        { header: '分类', key: 'category', width: 8, formatter: (v) => v === 'business' ? '业务' : '费用' },
        { header: '金额', key: 'amount', width: 14, type: 'money' },
        { header: '账户', key: 'account.name', width: 18 },
        { header: '合同编号', key: 'contract.contract_no', width: 18 },
        { header: '客户', key: 'customer.name', width: 20 },
        { header: '供应商', key: 'supplier.name', width: 20 },
        { header: '摘要', key: 'summary', width: 30 },
        { header: '确认状态', key: 'confirm_status', width: 10, formatter: (v) => v === 'confirmed' ? '已确认' : '待确认' },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('收付款明细') };
  }

  /**
   * 导出合同列表
   */
  async exportContracts(query, userId, userRole) {
    const where = {};
    if (userRole === 'agent') where.owner_id = userId;
    const { type, status, customer_id, supplier_id, keyword } = query;
    if (type) where.type = type;
    if (status) where.status = status;
    if (customer_id) where.customer_id = parseInt(customer_id, 10);
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);
    if (keyword) {
      where[Op.or] = [
        { contract_no: { [Op.like]: `%${keyword}%` } },
        { title: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const rows = await Contract.findAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['sign_date', 'DESC']],
      limit: MAX_EXPORT
    });

    const buffer = await buildExcel({
      title: '合同列表',
      sheetName: '合同',
      columns: [
        { header: '合同编号', key: 'contract_no', width: 20 },
        { header: '类型', key: 'type', width: 10, formatter: (v) => v === 'sale' ? '销售' : '采购' },
        { header: '标题', key: 'title', width: 30 },
        { header: '客户', key: 'customer.name', width: 22 },
        { header: '供应商', key: 'supplier.name', width: 22 },
        { header: '金额', key: 'amount', width: 14, type: 'money' },
        { header: '已收/付', key: 'paid_amount', width: 14, type: 'money' },
        { header: '执行进度', key: null, width: 10, formatter: (_, row) => {
          const amt = parseFloat(row.amount) || 0;
          const paid = parseFloat(row.paid_amount) || 0;
          return amt > 0 ? ((paid / amt) * 100).toFixed(1) + '%' : '-';
        }},
        { header: '签订日期', key: 'sign_date', width: 12, type: 'date' },
        { header: '到期日期', key: 'expire_date', width: 12, type: 'date' },
        { header: '状态', key: 'status', width: 10 },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('合同列表') };
  }

  /**
   * 导出专利库存清单
   */
  async exportInventory(query, userId, userRole) {
    const where = {};
    if (userRole === 'agent') where.created_by = userId;
    if (query.status) where.status = query.status;
    if (query.tech_field) where.tech_field = { [Op.like]: `%${query.tech_field}%` };

    const rows = await PatentInventory.findAll({
      where,
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['stock_in_date', 'DESC']],
      limit: MAX_EXPORT
    });

    // 附加派生字段
    const today = Date.now();
    const list = rows.map(r => {
      const obj = r.toJSON();
      if (obj.stock_in_date) {
        obj.stock_age_days = Math.max(0, Math.round(
          (today - new Date(obj.stock_in_date).getTime()) / 86400000
        ));
      }
      const cp = parseFloat(obj.current_price) || 0;
      const pp = parseFloat(obj.purchase_price) || 0;
      const mc = parseFloat(obj.total_maintain_cost) || 0;
      obj.estimate_profit = parseFloat((cp - pp - mc).toFixed(2));
      return obj;
    });

    const buffer = await buildExcel({
      title: '专利库存清单',
      sheetName: '专利库存',
      columns: [
        { header: '专利号', key: 'patent_no', width: 20 },
        { header: '专利名称', key: 'patent_name', width: 40 },
        { header: '类型', key: 'patent_type', width: 12 },
        { header: '技术领域', key: 'tech_field', width: 16 },
        { header: '供应商', key: 'supplier.name', width: 22 },
        { header: '采购价', key: 'purchase_price', width: 14, type: 'money' },
        { header: '现价', key: 'current_price', width: 14, type: 'money' },
        { header: '累计维持', key: 'total_maintain_cost', width: 14, type: 'money' },
        { header: '利润预估', key: 'estimate_profit', width: 14, type: 'money' },
        { header: '库龄(天)', key: 'stock_age_days', width: 10 },
        { header: '下次年费日', key: 'next_fee_deadline', width: 14, type: 'date' },
        { header: '状态', key: 'status', width: 10 },
        { header: '入库日期', key: 'stock_in_date', width: 14, type: 'date' },
        { header: '出库日期', key: 'stock_out_date', width: 14, type: 'date' }
      ],
      rows: list
    });

    return { buffer, filename: buildFilename('专利库存清单') };
  }

  /**
   * 导出发票列表
   */
  async exportInvoices(query) {
    const where = {};
    const { type, status, start_date, end_date } = query;
    if (type) where.type = type;
    if (status) where.status = status;
    if (start_date || end_date) {
      where.invoice_date = {};
      if (start_date) where.invoice_date[Op.gte] = start_date;
      if (end_date) where.invoice_date[Op.lte] = end_date;
    }

    const rows = await Invoice.findAll({
      where,
      include: [
        { model: Contract, as: 'contract', attributes: ['id', 'contract_no'] },
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['invoice_date', 'DESC']],
      limit: MAX_EXPORT
    });

    const buffer = await buildExcel({
      title: '发票列表',
      sheetName: '发票',
      columns: [
        { header: '发票号', key: 'invoice_no', width: 20 },
        { header: '类型', key: 'type', width: 10, formatter: (v) => v === 'output' ? '销项' : '进项' },
        { header: '票种', key: 'invoice_type', width: 10, formatter: (v) => v === 'special' ? '专票' : '普票' },
        { header: '金额(不含税)', key: 'amount', width: 16, type: 'money' },
        { header: '税额', key: 'tax_amount', width: 14, type: 'money' },
        { header: '价税合计', key: 'total_amount', width: 16, type: 'money' },
        { header: '开票日期', key: 'invoice_date', width: 12, type: 'date' },
        { header: '关联合同', key: 'contract.contract_no', width: 20 },
        { header: '客户', key: 'customer.name', width: 22 },
        { header: '供应商', key: 'supplier.name', width: 22 },
        { header: '状态', key: 'status', width: 10 },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('发票列表') };
  }

  /**
   * 导出报销明细
   */
  async exportExpenses(query, userId, userRole) {
    const where = {};
    if (userRole === 'agent') where.created_by = userId;
    const { user_id, cost_category_id, confirm_status, start_date, end_date } = query;
    if (user_id) where.user_id = parseInt(user_id, 10);
    if (cost_category_id) where.cost_category_id = parseInt(cost_category_id, 10);
    if (confirm_status) where.confirm_status = confirm_status;
    if (start_date || end_date) {
      where.expense_date = {};
      if (start_date) where.expense_date[Op.gte] = start_date;
      if (end_date) where.expense_date[Op.lte] = end_date;
    }

    // 关联 cost_categories 展示类别名
    const rows = await Expense.findAll({
      where,
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name'] }
      ],
      order: [['expense_date', 'DESC']],
      limit: MAX_EXPORT
    });

    const categoryIds = [...new Set(rows.map(r => r.cost_category_id).filter(Boolean))];
    const categories = await CostCategory.findAll({
      where: { id: { [Op.in]: categoryIds.length ? categoryIds : [0] } }
    });
    const catMap = {};
    categories.forEach(c => { catMap[c.id] = c.name; });

    const buffer = await buildExcel({
      title: '报销明细',
      sheetName: '报销',
      columns: [
        { header: '费用日期', key: 'expense_date', width: 12, type: 'date' },
        { header: '报销人ID', key: 'user_id', width: 10 },
        { header: '金额', key: 'amount', width: 14, type: 'money' },
        { header: '类别', key: 'cost_category_id', width: 16, formatter: (v) => catMap[v] || (v ? `#${v}` : '-') },
        { header: '账户', key: 'account.name', width: 18 },
        { header: '摘要', key: 'summary', width: 30 },
        { header: '确认状态', key: 'confirm_status', width: 10, formatter: (v) => v === 'confirmed' ? '已确认' : '待确认' },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('报销明细') };
  }

  /**
   * 导出交易项目（含利润）
   */
  async exportProjects(query, userId, userRole) {
    const where = {};
    if (userRole === 'agent') {
      where[Op.or] = [{ created_by: userId }, { owner_id: userId }];
    }
    if (query.status) where.status = query.status;

    const rows = await Project.findAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['create_time', 'DESC']],
      limit: MAX_EXPORT
    });

    const buffer = await buildExcel({
      title: '交易项目列表',
      sheetName: '交易项目',
      columns: [
        { header: '项目名称', key: 'name', width: 30 },
        { header: '专利号', key: 'patent_no', width: 20 },
        { header: '客户', key: 'customer.name', width: 22 },
        { header: '供应商', key: 'supplier.name', width: 22 },
        { header: '销售收入', key: 'sale_amount', width: 14, type: 'money' },
        { header: '采购成本', key: 'purchase_amount', width: 14, type: 'money' },
        { header: '税点成本', key: 'tax_cost', width: 14, type: 'money' },
        { header: '维持成本', key: 'maintain_cost', width: 14, type: 'money' },
        { header: '毛利润', key: 'gross_profit', width: 14, type: 'money' },
        { header: '状态', key: 'status', width: 10 },
        { header: '创建时间', key: 'create_time', width: 18, type: 'datetime' }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('交易项目') };
  }

  /**
   * 导出成本记录
   */
  async exportCosts(query) {
    const where = {};
    if (query.cost_month) where.cost_month = query.cost_month;
    if (query.start_month) where.cost_month = { ...(where.cost_month || {}), [Op.gte]: query.start_month };
    if (query.end_month) where.cost_month = { ...(where.cost_month || {}), [Op.lte]: query.end_month };

    const rows = await CostRecord.findAll({
      where,
      include: [
        { model: CostCategory, as: 'category', attributes: ['id', 'name', 'type'] },
        { model: BankAccount, as: 'account', attributes: ['id', 'name'] }
      ],
      order: [['cost_month', 'DESC']],
      limit: MAX_EXPORT
    });

    const TYPE_LABEL = {
      labor: '人力', operation: '运营', patent: '专利维持',
      marketing: '营销', other: '其他'
    };

    const buffer = await buildExcel({
      title: '成本记录',
      sheetName: '成本',
      columns: [
        { header: '月份', key: 'cost_month', width: 10 },
        { header: '大类', key: 'category.type', width: 10, formatter: (v) => TYPE_LABEL[v] || v },
        { header: '类别', key: 'category.name', width: 16 },
        { header: '金额', key: 'amount', width: 14, type: 'money' },
        { header: '关联用户', key: 'user_id', width: 10 },
        { header: '账户', key: 'account.name', width: 18 },
        { header: '固定月费', key: 'is_recurring', width: 10, formatter: (v) => v ? '是' : '否' },
        { header: '摘要', key: 'summary', width: 30 },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows: rows.map(r => r.toJSON())
    });

    return { buffer, filename: buildFilename('成本记录') };
  }
}

module.exports = new ExportService();
