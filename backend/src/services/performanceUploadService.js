/**
 * ============================================================
 * 业绩上传服务（PerformanceUploadService）
 * ============================================================
 * 职责：
 *   1) 生成业绩统计表 Excel 模板
 *   2) 解析上传文件，逐行校验 + 匹配员工（按姓名）
 *   3) 确认入库（事务批量写入 performance_imports + performance_records）
 *   4) 批次列表 / 明细查询 / 删除草稿
 *
 * 【流程】
 *   下载模板 → 填写上传 → parseAndValidate(预览) → confirmImport(入库) → 算提成
 *
 * 【归属月规则】
 *   业绩归属"尾款日期所在月"，提成在"归属月+1"工资条发放。
 *   year/month 取自 final_payment_date（没填则回退到上传指定的 year/month）。
 *
 * 【员工匹配】
 *   按 employee_name 在 employees 表精确匹配 name；
 *   匹配不上 employee_id/user_id 为空，预览标红，禁止确认。
 * ============================================================
 */

const ExcelJS = require('exceljs');
const { sequelize } = require('../config/database');
const { buildExcel, buildFilename } = require('../utils/excelHelper');
const PerformanceImport = require('../models/PerformanceImport');
const PerformanceRecord = require('../models/PerformanceRecord');
const Employee = require('../models/Employee');

// ==================== 模板定义 ====================

const TEMPLATE_COLUMNS = [
  { header: '姓名*', key: 'employee_name', width: 12, required: true },
  { header: '业务类型', key: 'business_type', width: 16 },
  { header: '流水号', key: 'serial_no', width: 18 },
  { header: '专利号/项目号', key: 'target_no', width: 22 },
  { header: '专利名/项目名', key: 'target_name', width: 36 },
  { header: '合同金额', key: 'contract_amount', width: 14 },
  { header: '核定业绩*', key: 'performance_amount', width: 14, required: true },
  { header: '合同日期(YYYY-MM-DD)', key: 'contract_date', width: 18 },
  { header: '尾款日期(YYYY-MM-DD)', key: 'final_payment_date', width: 18 },
  { header: '是否全风险代理(是/否)', key: 'is_full_risk_agent', width: 18 },
  { header: '备注', key: 'remark', width: 24 }
];

const EXAMPLE_ROW = {
  employee_name: '张三',
  business_type: '发明专利买卖',
  serial_no: 'LS-2026-001',
  target_no: 'CN202310000001.1',
  target_name: '一种数据处理方法',
  contract_amount: 30000,
  performance_amount: 2000,
  contract_date: '2026-05-10',
  final_payment_date: '2026-05-28',
  is_full_risk_agent: '否',
  remark: '示例数据，导入时请删除'
};

class PerformanceUploadService {

  /**
   * 生成业绩上传模板
   * @returns {Promise<{buffer: Buffer, filename: string}>}
   */
  async generateTemplate() {
    const buffer = await buildExcel({
      sheetName: '业绩统计表',
      columns: TEMPLATE_COLUMNS,
      rows: [EXAMPLE_ROW],
      title: '业绩统计表（第 2 行为示例数据，导入时请删除）'
    });
    return { buffer, filename: buildFilename('业绩统计表模板') };
  }

  /**
   * 解析上传 Excel 并校验（预览，不入库）
   * @param {Buffer} fileBuffer
   * @param {number} fallbackYear  尾款日期为空时的回退年份
   * @param {number} fallbackMonth 尾款日期为空时的回退月份
   * @returns {Promise<{valid:Array, errors:Array, total:number, summary:Object}>}
   */
  async parseAndValidate(fileBuffer, fallbackYear, fallbackMonth) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Excel 文件中没有工作表');

    // 确定表头行（可能有标题行）
    let headerRowIdx = 1;
    const firstCell = sheet.getCell(1, 1).value;
    if (firstCell && typeof firstCell === 'string' && firstCell.includes('业绩统计表')) {
      headerRowIdx = 2;
    }

    // 表头列映射
    const headerRow = sheet.getRow(headerRowIdx);
    const colMap = {};
    TEMPLATE_COLUMNS.forEach((col) => {
      for (let i = 1; i <= headerRow.cellCount; i++) {
        const cellVal = String(headerRow.getCell(i).value || '').trim();
        const cleanHeader = col.header.replace(/\*/, '').replace(/[（(].*[)）]/, '').trim();
        const cleanCell = cellVal.replace(/\*/, '').replace(/[（(].*[)）]/, '').trim();
        if (cleanCell === cleanHeader || cellVal === col.header) {
          colMap[i] = col.key;
          break;
        }
      }
    });

    // 预加载员工，用于姓名匹配
    const employees = await Employee.findAll({ raw: true });
    const empByName = {};
    employees.forEach(e => { empByName[String(e.name).trim()] = e; });

    const valid = [];
    const errors = [];
    let total = 0;
    let totalPerformance = 0;

    for (let rowIdx = headerRowIdx + 1; rowIdx <= sheet.rowCount; rowIdx++) {
      const row = sheet.getRow(rowIdx);
      if (!row.hasValues) continue;

      const rowData = {};
      Object.entries(colMap).forEach(([colIdx, key]) => {
        rowData[key] = this._cellValue(row.getCell(parseInt(colIdx)).value);
      });

      // 整行空跳过
      if (!rowData.employee_name && !rowData.performance_amount) continue;
      total++;

      const rowErrors = [];

      // 必填校验
      if (!rowData.employee_name) rowErrors.push('姓名不能为空');
      const perf = parseFloat(rowData.performance_amount);
      if (rowData.performance_amount === '' || rowData.performance_amount == null || isNaN(perf)) {
        rowErrors.push('核定业绩必须为数字');
      }

      // 员工匹配
      const emp = rowData.employee_name ? empByName[String(rowData.employee_name).trim()] : null;
      if (rowData.employee_name && !emp) {
        rowErrors.push(`姓名"${rowData.employee_name}"未匹配到员工`);
      }

      // 归属月：取尾款日期所在月，否则回退
      const { year, month } = this._resolveAttributionMonth(
        rowData.final_payment_date, fallbackYear, fallbackMonth
      );

      const normalized = {
        employee_id: emp ? emp.id : null,
        user_id: emp ? emp.user_id : null,
        employee_name: rowData.employee_name || '',
        business_type: rowData.business_type || '',
        serial_no: rowData.serial_no || '',
        target_no: rowData.target_no || '',
        target_name: rowData.target_name || '',
        contract_amount: this._toNumber(rowData.contract_amount),
        performance_amount: isNaN(perf) ? 0 : perf,
        contract_date: this._toDate(rowData.contract_date),
        final_payment_date: this._toDate(rowData.final_payment_date),
        is_full_risk_agent: this._toBool(rowData.is_full_risk_agent),
        remark: rowData.remark || '',
        year,
        month
      };

      if (rowErrors.length > 0) {
        errors.push({ row: rowIdx, data: normalized, errors: rowErrors });
      } else {
        valid.push({ row: rowIdx, data: normalized });
        totalPerformance += normalized.performance_amount;
      }
    }

    return {
      valid,
      errors,
      total,
      summary: {
        valid_count: valid.length,
        error_count: errors.length,
        total_performance: parseFloat(totalPerformance.toFixed(2))
      }
    };
  }

  /**
   * 确认入库（事务）
   * @param {Object} params { year, month, file_name, records:[normalized...], userId }
   * @returns {Promise<{batch_id:number, record_count:number}>}
   */
  async confirmImport({ year, month, file_name, records, userId }) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('没有可导入的业绩明细');
    }
    // 拒绝含未匹配员工的明细
    const unmatched = records.filter(r => !r.employee_id);
    if (unmatched.length > 0) {
      throw new Error(`存在 ${unmatched.length} 条未匹配员工的明细，请修正后再导入`);
    }

    // 防重复：同年月已存在已确认批次时拒绝，避免提成基数被重复累加（工资多发）
    const existedConfirmed = await PerformanceImport.findOne({
      where: { year, month, status: 'confirmed' }
    });
    if (existedConfirmed) {
      throw new Error(`${year}年${month}月已存在已确认的业绩批次（#${existedConfirmed.id}），如需重传请先删除旧批次`);
    }

    return sequelize.transaction(async (t) => {
      const totalPerformance = records.reduce(
        (s, r) => s + (parseFloat(r.performance_amount) || 0), 0
      );

      const batch = await PerformanceImport.create({
        year,
        month,
        file_name: file_name || null,
        record_count: records.length,
        total_performance: parseFloat(totalPerformance.toFixed(2)),
        status: 'confirmed',
        uploaded_by: userId,
        confirmed_by: userId,
        confirmed_at: new Date()
      }, { transaction: t });

      const rows = records.map(r => ({
        batch_id: batch.id,
        year: r.year || year,
        month: r.month || month,
        employee_id: r.employee_id,
        user_id: r.user_id,
        employee_name: r.employee_name,
        business_type: r.business_type,
        serial_no: r.serial_no,
        target_no: r.target_no,
        target_name: r.target_name,
        contract_amount: this._toNumber(r.contract_amount),
        performance_amount: this._toNumber(r.performance_amount),
        contract_date: r.contract_date || null,
        final_payment_date: r.final_payment_date || null,
        is_full_risk_agent: !!r.is_full_risk_agent,
        remark: r.remark || ''
      }));

      await PerformanceRecord.bulkCreate(rows, { transaction: t });

      return { batch_id: batch.id, record_count: rows.length };
    });
  }

  /**
   * 批次列表
   */
  async listBatches(query = {}) {
    const where = {};
    if (query.year) where.year = parseInt(query.year);
    if (query.month) where.month = parseInt(query.month);
    if (query.status) where.status = query.status;
    return PerformanceImport.findAll({ where, order: [['year', 'DESC'], ['month', 'DESC'], ['id', 'DESC']] });
  }

  /**
   * 批次明细
   */
  async getBatchRecords(batchId) {
    const batch = await PerformanceImport.findByPk(batchId);
    if (!batch) throw new Error('批次不存在');
    const records = await PerformanceRecord.findAll({
      where: { batch_id: batchId },
      order: [['employee_name', 'ASC'], ['id', 'ASC']]
    });
    return { batch, records };
  }

  /**
   * 删除批次（连同明细）
   */
  async removeBatch(batchId) {
    const batch = await PerformanceImport.findByPk(batchId);
    if (!batch) throw new Error('批次不存在');
    return sequelize.transaction(async (t) => {
      await PerformanceRecord.destroy({ where: { batch_id: batchId }, transaction: t });
      await batch.destroy({ transaction: t });
    });
  }

  /**
   * 获取某人某月的核定业绩合计（供工资条提成计算调用）
   * @param {number} employeeId
   * @param {number} year
   * @param {number} month
   * @returns {Promise<{total:number, count:number}>}
   */
  async getMonthlyPerformance(employeeId, year, month) {
    const result = await PerformanceRecord.findOne({
      attributes: [
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('performance_amount')), 0), 'total'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { employee_id: employeeId, year, month },
      raw: true
    });
    return {
      total: parseFloat(result.total) || 0,
      count: parseInt(result.count) || 0
    };
  }

  // ==================== 工具方法 ====================

  /** 提取 ExcelJS 单元格值（处理富文本/公式/日期对象） */
  _cellValue(val) {
    if (val == null) return '';
    if (typeof val === 'object') {
      if (val.result !== undefined) return val.result;
      if (val.richText) return val.richText.map(r => r.text).join('');
      if (val.text !== undefined) return val.text;
      if (val instanceof Date) return val.toISOString().slice(0, 10);
      return String(val);
    }
    return val;
  }

  _toNumber(v) {
    if (v === '' || v == null) return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  _toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    // 兼容 YYYY-MM-DD 和 YYYY/MM/DD
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    }
    return null;
  }

  _toBool(v) {
    if (v === true) return true;
    const s = String(v || '').trim();
    return s === '是' || s === 'Y' || s === 'y' || s === '1' || s.toLowerCase() === 'true';
  }

  /** 由尾款日期推导归属年月，缺失则回退 */
  _resolveAttributionMonth(finalPaymentDate, fallbackYear, fallbackMonth) {
    const d = this._toDate(finalPaymentDate);
    if (d) {
      const [y, m] = d.split('-');
      return { year: parseInt(y), month: parseInt(m) };
    }
    return { year: parseInt(fallbackYear), month: parseInt(fallbackMonth) };
  }
}

module.exports = new PerformanceUploadService();
