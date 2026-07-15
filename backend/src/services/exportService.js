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
 *   payroll       工资条明细
 *
 * 【安全限制】
 *   - 最大导出 5000 条，防止全量拉取把数据库打爆
 *   - 使用与列表一致的筛选，保证用户看到的和导出的一致
 *
 * 【数据隔离】
 *   路由组合模块 view/export 两项权限，按更窄 scope 生成 dataFilter；
 *   本服务不读取角色，缺失 dataFilter 时默认拒绝匹配。
 * ============================================================
 */

const { Op } = require('sequelize');
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
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const { buildExcel, buildFilename } = require('../utils/excelHelper');

/** 单次导出最大条数（防拉爆） */
const MAX_EXPORT = 5000;
const DENY_EXPORT_FILTER = Object.freeze({ id: -1 });

function normalizeExportDataFilter(dataFilter) {
  if (!dataFilter || typeof dataFilter !== 'object' || Array.isArray(dataFilter)) {
    return { ...DENY_EXPORT_FILTER };
  }
  return { ...dataFilter };
}

class ExportService {
  /**
   * 导出收付款明细
   */
  async exportPayments(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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
  async exportContracts(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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
  async exportInventory(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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
  async exportInvoices(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
    const {
      type,
      status,
      contract_id,
      customer_id,
      supplier_id,
      keyword,
      start_date,
      end_date
    } = query;
    if (type) where.type = type;
    if (status) where.status = status;
    if (contract_id) where.contract_id = parseInt(contract_id, 10);
    if (customer_id) where.customer_id = parseInt(customer_id, 10);
    if (supplier_id) where.supplier_id = parseInt(supplier_id, 10);
    if (keyword) {
      where[Op.or] = [
        { invoice_no: { [Op.like]: `%${keyword}%` } },
        { remark: { [Op.like]: `%${keyword}%` } }
      ];
    }
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
  async exportExpenses(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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
  async exportProjects(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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
  async exportCosts(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
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

  /**
   * 导出工资条。工资属于公司级敏感数据，Manifest 只允许 all scope；
   * 路由仍要求 payroll.view/export 两项权限取交集并实时校验权限版本。
   */
  async exportPayroll(query, dataFilter) {
    const where = normalizeExportDataFilter(dataFilter);
    const { year, month, status, employee_id } = query;
    if (year) where.year = parseInt(year, 10);
    if (month) where.month = parseInt(month, 10);
    if (status) where.status = status;
    if (employee_id) where.employee_id = parseInt(employee_id, 10);

    const payrolls = await Payroll.findAll({
      where,
      order: [['year', 'DESC'], ['month', 'DESC'], ['is_adjustment', 'ASC'], ['net_salary', 'DESC']],
      limit: MAX_EXPORT
    });
    const employeeIds = [...new Set(payrolls.map((row) => Number(row.employee_id)).filter(Number.isInteger))];
    const employees = await Employee.findAll({
      where: { id: { [Op.in]: employeeIds.length > 0 ? employeeIds : [0] } },
      attributes: ['id', 'name', 'role', 'grade'],
      raw: true
    });
    const employeeById = new Map(employees.map((employee) => [Number(employee.id), employee]));
    const rows = payrolls.map((row) => {
      const record = row.toJSON();
      const employee = employeeById.get(Number(record.employee_id)) || {};
      return {
        ...record,
        employee_name: employee.name || '',
        employee_role: employee.role || '',
        employee_grade: employee.grade || ''
      };
    });

    const buffer = await buildExcel({
      title: '工资条明细',
      sheetName: '工资条',
      columns: [
        { header: '年份', key: 'year', width: 8 },
        { header: '月份', key: 'month', width: 8 },
        { header: '员工', key: 'employee_name', width: 16 },
        { header: '岗位', key: 'employee_role', width: 12 },
        { header: '职级', key: 'employee_grade', width: 8 },
        { header: '基本工资', key: 'base_salary', width: 12, type: 'money' },
        { header: '岗位补贴', key: 'position_allowance', width: 12, type: 'money' },
        { header: '全勤奖', key: 'attendance_bonus', width: 12, type: 'money' },
        { header: '职级津贴', key: 'grade_allowance', width: 12, type: 'money' },
        { header: '销售提成', key: 'commission', width: 12, type: 'money' },
        { header: '采购提成', key: 'purchase_commission', width: 12, type: 'money' },
        { header: '奖金', key: 'bonus', width: 12, type: 'money' },
        { header: '应发合计', key: 'gross_income', width: 14, type: 'money' },
        { header: '社保公积金', key: 'social_insurance', width: 14, type: 'money' },
        { header: '个人所得税', key: 'income_tax', width: 14, type: 'money' },
        { header: '请假扣款', key: 'leave_deduction', width: 12, type: 'money' },
        { header: '其他扣款', key: 'other_deduction', width: 12, type: 'money' },
        { header: '扣除合计', key: 'total_deduction', width: 14, type: 'money' },
        { header: '实发工资', key: 'net_salary', width: 14, type: 'money' },
        { header: '调整项', key: 'is_adjustment', width: 10, formatter: (value) => value ? '是' : '否' },
        { header: '状态', key: 'status', width: 10 },
        { header: '备注', key: 'remark', width: 30 }
      ],
      rows
    });

    return { buffer, filename: buildFilename('工资条明细') };
  }
}

module.exports = new ExportService();
module.exports.normalizeExportDataFilter = normalizeExportDataFilter;
