/**
 * ============================================================
 * 历史数据导入服务（ImportService）
 * ============================================================
 * 职责：
 *   1) 生成各业务模块的 Excel 导入模板（含表头 + 示例行 + 说明）
 *   2) 解析上传的 Excel 文件，逐行校验数据
 *   3) 事务批量写入数据库（失败整批回滚）
 *
 * 支持的导入类型：
 *   - contracts   合同
 *   - payments    收付款
 *   - inventory   专利库存
 *   - costs       成本记录
 *
 * 【设计要点】
 *   - 模板下载：buildExcel 生成带示例行的 .xlsx
 *   - 预览校验：返回 {valid: [...], errors: [...]}，前端展示后用户确认
 *   - 批量写入：事务包裹，任一行失败则全部回滚
 *   - 重复检测：合同用 contract_no，专利用 patent_no
 * ============================================================
 */

const ExcelJS = require('exceljs');
const { sequelize } = require('../config/database');
const { buildExcel, buildFilename } = require('../utils/excelHelper');
const {
  Contract,
  Payment,
  PatentInventory,
  CostRecord,
  Customer,
  Supplier,
  BankAccount,
  CostCategory
} = require('../models');

// ==================== 模板定义 ====================

/**
 * 各导入类型的列定义
 * required: 是否必填
 * validate: 校验函数（返回 null 表示通过，否则返回错误信息）
 */
const TEMPLATE_DEFS = {
  contracts: {
    sheetName: '合同导入模板',
    columns: [
      { header: '合同编号*', key: 'contract_no', width: 20, required: true },
      { header: '合同类型*(sale/purchase)', key: 'type', width: 20, required: true },
      { header: '合同标题*', key: 'title', width: 30, required: true },
      { header: '金额*', key: 'amount', width: 15, required: true },
      { header: '签订日期(YYYY-MM-DD)', key: 'sign_date', width: 18 },
      { header: '到期日期(YYYY-MM-DD)', key: 'expire_date', width: 18 },
      { header: '客户名称', key: 'customer_name', width: 20 },
      { header: '供应商名称', key: 'supplier_name', width: 20 },
      { header: '状态(draft/active/completed/terminated)', key: 'status', width: 20 },
      { header: '备注', key: 'remark', width: 30 }
    ],
    example: {
      contract_no: 'HT-2026-001',
      type: 'sale',
      title: '专利转让合同',
      amount: 50000,
      sign_date: '2026-01-15',
      expire_date: '2026-12-31',
      customer_name: '示例客户',
      supplier_name: '',
      status: 'active',
      remark: '示例数据'
    }
  },

  payments: {
    sheetName: '收付款导入模板',
    columns: [
      { header: '类型*(income/expense)', key: 'type', width: 18, required: true },
      { header: '分类*(business/fee)', key: 'category', width: 18, required: true },
      { header: '金额*', key: 'amount', width: 15, required: true },
      { header: '日期*(YYYY-MM-DD)', key: 'payment_date', width: 18, required: true },
      { header: '摘要', key: 'summary', width: 30 },
      { header: '账户名称', key: 'account_name', width: 20 },
      { header: '合同编号(业务类)', key: 'contract_no', width: 20 },
      { header: '客户名称(收款)', key: 'customer_name', width: 20 },
      { header: '供应商名称(付款)', key: 'supplier_name', width: 20 },
      { header: '支付方式(transfer/check/cash/other)', key: 'payment_method', width: 20 },
      { header: '确认状态(pending/confirmed)', key: 'confirm_status', width: 18 },
      { header: '备注', key: 'remark', width: 30 }
    ],
    example: {
      type: 'income',
      category: 'business',
      amount: 25000,
      payment_date: '2026-02-01',
      summary: '合同首付款',
      account_name: '工商银行',
      contract_no: 'HT-2026-001',
      customer_name: '示例客户',
      supplier_name: '',
      payment_method: 'transfer',
      confirm_status: 'confirmed',
      remark: ''
    }
  },

  inventory: {
    sheetName: '专利库存导入模板',
    columns: [
      { header: '专利号*', key: 'patent_no', width: 22, required: true },
      { header: '专利名称*', key: 'patent_name', width: 40, required: true },
      { header: '专利类型(发明/实用新型/外观)', key: 'patent_type', width: 20 },
      { header: '技术领域', key: 'tech_field', width: 16 },
      { header: '采购价格*', key: 'purchase_price', width: 14, required: true },
      { header: '当前售价*', key: 'current_price', width: 14, required: true },
      { header: '采购日期(YYYY-MM-DD)', key: 'purchase_date', width: 18 },
      { header: '入库日期(YYYY-MM-DD)', key: 'stock_in_date', width: 18 },
      { header: '供应商名称', key: 'supplier_name', width: 20 },
      { header: '状态(in_stock/sold/abandoned/transferring)', key: 'status', width: 20 },
      { header: '备注', key: 'remark', width: 30 }
    ],
    example: {
      patent_no: 'CN202310000001.1',
      patent_name: '一种数据处理方法',
      patent_type: '发明',
      tech_field: '通信',
      purchase_price: 8000,
      current_price: 15000,
      purchase_date: '2025-06-01',
      stock_in_date: '2025-06-15',
      supplier_name: '示例供应商',
      status: 'in_stock',
      remark: ''
    }
  },

  costs: {
    sheetName: '成本记录导入模板',
    columns: [
      { header: '所属月份*(YYYY-MM)', key: 'cost_month', width: 16, required: true },
      { header: '类别名称*', key: 'category_name', width: 20, required: true },
      { header: '金额*', key: 'amount', width: 14, required: true },
      { header: '摘要', key: 'summary', width: 30 },
      { header: '账户名称', key: 'account_name', width: 20 },
      { header: '是否固定月费(0/1)', key: 'is_recurring', width: 16 },
      { header: '备注', key: 'remark', width: 30 }
    ],
    example: {
      cost_month: '2026-01',
      category_name: '办公租金',
      amount: 5000,
      summary: '1月办公室租金',
      account_name: '工商银行',
      is_recurring: 1,
      remark: ''
    }
  }
};

// ==================== 模板生成 ====================

/**
 * 生成导入模板 Excel
 * @param {string} type 导入类型（contracts/payments/inventory/costs）
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function generateTemplate(type) {
  const def = TEMPLATE_DEFS[type];
  if (!def) throw new Error(`不支持的导入类型: ${type}`);

  const buffer = await buildExcel({
    sheetName: def.sheetName,
    columns: def.columns,
    rows: [def.example],
    title: `${def.sheetName}（第 2 行为示例数据，导入时请删除）`
  });

  const filename = buildFilename(`导入模板_${type}`);
  return { buffer, filename };
}

// ==================== 数据解析 + 校验 ====================

/**
 * 解析上传的 Excel 文件并校验数据
 * @param {string} type 导入类型
 * @param {Buffer} fileBuffer Excel 文件 Buffer
 * @param {number} userId 操作用户 ID
 * @returns {Promise<{valid: Array, errors: Array, total: number}>}
 */
async function parseAndValidate(type, fileBuffer, userId) {
  const def = TEMPLATE_DEFS[type];
  if (!def) throw new Error(`不支持的导入类型: ${type}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Excel 文件中没有工作表');

  // 确定表头行（跳过可能的标题行）
  let headerRowIdx = 1;
  const firstCell = sheet.getCell(1, 1).value;
  if (firstCell && typeof firstCell === 'string' && firstCell.includes('模板')) {
    headerRowIdx = 2; // 有标题行，表头在第 2 行
  }

  // 读取表头映射
  const headerRow = sheet.getRow(headerRowIdx);
  const colMap = {}; // colIndex → key
  def.columns.forEach((col) => {
    for (let i = 1; i <= headerRow.cellCount; i++) {
      const cellVal = String(headerRow.getCell(i).value || '').trim();
      // 匹配表头（去掉 * 号和括号说明）
      const cleanHeader = col.header.replace(/\*/, '').replace(/\(.*\)/, '').trim();
      const cleanCell = cellVal.replace(/\*/, '').replace(/\(.*\)/, '').replace(/（.*）/, '').trim();
      if (cleanCell === cleanHeader || cellVal === col.header) {
        colMap[i] = col.key;
        break;
      }
    }
  });

  // 读取数据行
  const valid = [];
  const errors = [];
  let total = 0;

  for (let rowIdx = headerRowIdx + 1; rowIdx <= sheet.rowCount; rowIdx++) {
    const row = sheet.getRow(rowIdx);
    // 跳过空行
    if (!row.hasValues) continue;

    total++;
    const rowData = {};
    Object.entries(colMap).forEach(([colIdx, key]) => {
      let val = row.getCell(parseInt(colIdx)).value;
      // ExcelJS 可能返回 { richText: [...] } 或 { result: ... }
      if (val && typeof val === 'object') {
        if (val.result !== undefined) val = val.result;
        else if (val.richText) val = val.richText.map(r => r.text).join('');
        else if (val instanceof Date) val = val.toISOString().slice(0, 10);
        else val = String(val);
      }
      rowData[key] = val;
    });

    // 校验必填字段
    const rowErrors = [];
    def.columns.forEach(col => {
      if (col.required) {
        const v = rowData[col.key];
        if (v === null || v === undefined || v === '') {
          rowErrors.push(`${col.header.replace('*', '')} 不能为空`);
        }
      }
    });

    // 类型特定校验
    const typeErrors = await validateRow(type, rowData, rowIdx);
    rowErrors.push(...typeErrors);

    if (rowErrors.length > 0) {
      errors.push({ row: rowIdx, data: rowData, errors: rowErrors });
    } else {
      valid.push({ row: rowIdx, data: rowData });
    }
  }

  return { valid, errors, total };
}

/**
 * 按类型校验单行数据
 */
async function validateRow(type, data, rowIdx) {
  const errors = [];

  switch (type) {
    case 'contracts':
      if (data.type && !['sale', 'purchase'].includes(data.type)) {
        errors.push('合同类型必须为 sale 或 purchase');
      }
      if (data.amount && (isNaN(parseFloat(data.amount)) || parseFloat(data.amount) < 0)) {
        errors.push('金额必须为非负数字');
      }
      if (data.status && !['draft', 'pending', 'active', 'completed', 'terminated'].includes(data.status)) {
        errors.push('状态值无效');
      }
      break;

    case 'payments':
      if (data.type && !['income', 'expense'].includes(data.type)) {
        errors.push('类型必须为 income 或 expense');
      }
      if (data.category && !['business', 'fee'].includes(data.category)) {
        errors.push('分类必须为 business 或 fee');
      }
      if (data.amount && (isNaN(parseFloat(data.amount)) || parseFloat(data.amount) < 0)) {
        errors.push('金额必须为非负数字');
      }
      if (data.confirm_status && !['pending', 'confirmed'].includes(data.confirm_status)) {
        errors.push('确认状态必须为 pending 或 confirmed');
      }
      break;

    case 'inventory':
      if (data.purchase_price && (isNaN(parseFloat(data.purchase_price)) || parseFloat(data.purchase_price) < 0)) {
        errors.push('采购价格必须为非负数字');
      }
      if (data.current_price && (isNaN(parseFloat(data.current_price)) || parseFloat(data.current_price) < 0)) {
        errors.push('当前售价必须为非负数字');
      }
      if (data.status && !['in_stock', 'sold', 'abandoned', 'transferring'].includes(data.status)) {
        errors.push('状态值无效');
      }
      break;

    case 'costs':
      if (data.cost_month && !/^\d{4}-\d{2}$/.test(data.cost_month)) {
        errors.push('月份格式必须为 YYYY-MM');
      }
      if (data.amount && (isNaN(parseFloat(data.amount)) || parseFloat(data.amount) < 0)) {
        errors.push('金额必须为非负数字');
      }
      break;
  }

  return errors;
}

// ==================== 批量写入 ====================

/**
 * 事务批量导入数据
 * @param {string} type 导入类型
 * @param {Array} validRows parseAndValidate 返回的 valid 数组
 * @param {number} userId 操作用户 ID
 * @returns {Promise<{imported: number, skipped: number, details: Array}>}
 */
async function batchImport(type, validRows, userId) {
  const t = await sequelize.transaction();
  let imported = 0;
  let skipped = 0;
  const details = [];

  try {
    for (const item of validRows) {
      const { row, data } = item;
      try {
        const result = await importSingleRow(type, data, userId, t);
        if (result.skipped) {
          skipped++;
          details.push({ row, status: 'skipped', reason: result.reason });
        } else {
          imported++;
          details.push({ row, status: 'success', id: result.id });
        }
      } catch (e) {
        // 单行失败 → 整批回滚
        await t.rollback();
        throw new Error(`第 ${row} 行导入失败: ${e.message}`);
      }
    }

    await t.commit();
    return { imported, skipped, details };
  } catch (e) {
    if (!t.finished) await t.rollback();
    throw e;
  }
}

/**
 * 导入单行数据（在事务内）
 */
async function importSingleRow(type, data, userId, transaction) {
  switch (type) {
    case 'contracts':
      return await importContract(data, userId, transaction);
    case 'payments':
      return await importPayment(data, userId, transaction);
    case 'inventory':
      return await importInventoryItem(data, userId, transaction);
    case 'costs':
      return await importCostRecord(data, userId, transaction);
    default:
      throw new Error(`不支持的导入类型: ${type}`);
  }
}

/**
 * 导入合同
 */
async function importContract(data, userId, transaction) {
  // 重复检测
  const existing = await Contract.findOne({
    where: { contract_no: data.contract_no },
    transaction
  });
  if (existing) {
    return { skipped: true, reason: `合同编号 ${data.contract_no} 已存在` };
  }

  // 解析客户/供应商名称 → ID
  let customer_id = null;
  let supplier_id = null;
  if (data.customer_name) {
    const customer = await Customer.findOne({
      where: { name: data.customer_name },
      transaction
    });
    if (customer) customer_id = customer.id;
  }
  if (data.supplier_name) {
    const supplier = await Supplier.findOne({
      where: { name: data.supplier_name },
      transaction
    });
    if (supplier) supplier_id = supplier.id;
  }

  // 合同模型枚举为 draft（无 pending）；模板历史使用 pending，做兼容映射避免整批导入因枚举报错回滚
  let status = data.status || 'active';
  if (status === 'pending') status = 'draft';

  const record = await Contract.create({
    contract_no: data.contract_no,
    type: data.type,
    title: data.title,
    amount: parseFloat(data.amount),
    paid_amount: 0,
    sign_date: data.sign_date || null,
    expire_date: data.expire_date || null,
    customer_id,
    supplier_id,
    status,
    remark: data.remark || null,
    created_by: userId
  }, { transaction });

  return { id: record.id };
}

/**
 * 导入收付款
 */
async function importPayment(data, userId, transaction) {
  // 解析关联实体名称 → ID
  let account_id = null;
  let contract_id = null;
  let customer_id = null;
  let supplier_id = null;

  if (data.account_name) {
    const account = await BankAccount.findOne({
      where: { name: data.account_name },
      transaction
    });
    if (account) account_id = account.id;
  }
  if (data.contract_no) {
    const contract = await Contract.findOne({
      where: { contract_no: data.contract_no },
      transaction
    });
    if (contract) contract_id = contract.id;
  }
  if (data.customer_name) {
    const customer = await Customer.findOne({
      where: { name: data.customer_name },
      transaction
    });
    if (customer) customer_id = customer.id;
  }
  if (data.supplier_name) {
    const supplier = await Supplier.findOne({
      where: { name: data.supplier_name },
      transaction
    });
    if (supplier) supplier_id = supplier.id;
  }

  const record = await Payment.create({
    type: data.type,
    category: data.category,
    amount: parseFloat(data.amount),
    payment_date: data.payment_date,
    summary: data.summary || null,
    account_id,
    contract_id,
    customer_id,
    supplier_id,
    payment_method: data.payment_method || 'transfer',
    confirm_status: data.confirm_status || 'confirmed',
    remark: data.remark || null,
    created_by: userId
  }, { transaction });

  return { id: record.id };
}

/**
 * 导入专利库存
 */
async function importInventoryItem(data, userId, transaction) {
  // 重复检测
  const existing = await PatentInventory.findOne({
    where: { patent_no: data.patent_no },
    transaction
  });
  if (existing) {
    return { skipped: true, reason: `专利号 ${data.patent_no} 已存在` };
  }

  // 解析供应商名称 → ID
  let supplier_id = null;
  if (data.supplier_name) {
    const supplier = await Supplier.findOne({
      where: { name: data.supplier_name },
      transaction
    });
    if (supplier) supplier_id = supplier.id;
  }

  const record = await PatentInventory.create({
    patent_no: data.patent_no,
    patent_name: data.patent_name,
    patent_type: data.patent_type || null,
    tech_field: data.tech_field || null,
    purchase_price: parseFloat(data.purchase_price),
    current_price: parseFloat(data.current_price),
    purchase_date: data.purchase_date || null,
    stock_in_date: data.stock_in_date || new Date().toISOString().slice(0, 10),
    supplier_id,
    status: data.status || 'in_stock',
    total_maintain_cost: 0,
    remark: data.remark || null,
    created_by: userId
  }, { transaction });

  return { id: record.id };
}

/**
 * 导入成本记录
 */
async function importCostRecord(data, userId, transaction) {
  // 解析类别名称 → ID
  let category_id = null;
  if (data.category_name) {
    const category = await CostCategory.findOne({
      where: { name: data.category_name },
      transaction
    });
    if (category) category_id = category.id;
  }
  if (!category_id) {
    throw new Error(`找不到类别: ${data.category_name}`);
  }

  // 解析账户名称 → ID
  let account_id = null;
  if (data.account_name) {
    const account = await BankAccount.findOne({
      where: { name: data.account_name },
      transaction
    });
    if (account) account_id = account.id;
  }

  const record = await CostRecord.create({
    category_id,
    amount: parseFloat(data.amount),
    cost_month: data.cost_month,
    summary: data.summary || null,
    account_id,
    user_id: userId,
    is_recurring: data.is_recurring ? parseInt(data.is_recurring) : 0,
    remark: data.remark || null,
    created_by: userId
  }, { transaction });

  return { id: record.id };
}

module.exports = {
  generateTemplate,
  parseAndValidate,
  batchImport,
  TEMPLATE_DEFS
};
