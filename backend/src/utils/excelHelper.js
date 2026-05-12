/**
 * ============================================================
 * Excel 导出辅助工具（ExcelHelper）
 * ============================================================
 *
 * 统一的 Excel 生成风格：
 *   - 表头单元格加粗 + 背景色
 *   - 日期/金额列自动宽度
 *   - 支持 column definition：{ header, key, width, formatter }
 *
 * 【使用示例】
 *   const buffer = await buildExcel({
 *     sheetName: '合同列表',
 *     columns: [
 *       { header: '合同编号', key: 'contract_no', width: 20 },
 *       { header: '金额',     key: 'amount',      width: 15, type: 'money' },
 *       { header: '签约日期', key: 'sign_date',   width: 14, type: 'date' }
 *     ],
 *     rows: [{contract_no: 'C-001', amount: 1000, sign_date: '2026-05-01'}]
 *   });
 *   res.setHeader('Content-Disposition', `attachment; filename="xxx.xlsx"`);
 *   res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 *   res.end(buffer);
 * ============================================================
 */

const ExcelJS = require('exceljs');

/** 常见金额/日期列的格式化 */
const FORMATTERS = {
  money: (v) => {
    if (v === null || v === undefined || v === '') return '';
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return n;
  },
  date: (v) => {
    if (!v) return '';
    // 确保输出为 YYYY-MM-DD 字符串格式（避免时区漂移）
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  },
  datetime: (v) => {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
};

/**
 * 生成 Excel Buffer
 *
 * @param {Object} options
 * @param {string} [options.sheetName='Sheet1']
 * @param {Array<{header, key, width?, type?, formatter?}>} options.columns
 * @param {Array<Object>} options.rows
 * @param {string} [options.title]  顶部合并大标题
 * @returns {Promise<Buffer>}
 */
async function buildExcel(options) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ERP 财务系统';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(options.sheetName || 'Sheet1');

  const columns = options.columns || [];
  const rows = options.rows || [];

  // ===== 标题行（可选）=====
  let headerRowIndex = 1;
  if (options.title) {
    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = options.title;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 26;
    headerRowIndex = 2;
  }

  // ===== 表头 =====
  const headerRow = sheet.getRow(headerRowIndex);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF409EFF' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top:    { style: 'thin' },
      bottom: { style: 'thin' },
      left:   { style: 'thin' },
      right:  { style: 'thin' }
    };
  });
  headerRow.height = 22;

  // ===== 列宽 =====
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width || 16;
  });

  // ===== 数据行 =====
  rows.forEach((row, rowIdx) => {
    const excelRow = sheet.getRow(headerRowIndex + 1 + rowIdx);
    columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const raw = getByPath(row, col.key);
      let value;

      if (typeof col.formatter === 'function') {
        value = col.formatter(raw, row);
      } else if (col.type && FORMATTERS[col.type]) {
        value = FORMATTERS[col.type](raw);
      } else {
        value = raw == null ? '' : raw;
      }

      cell.value = value;

      // 类型特定样式
      if (col.type === 'money' && typeof value === 'number') {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      } else if (col.type === 'date' || col.type === 'datetime') {
        cell.alignment = { horizontal: 'center' };
      }

      // 边框（轻量，避免文件过大时也可关闭）
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFE4E7ED' } },
        bottom: { style: 'thin', color: { argb: 'FFE4E7ED' } },
        left:   { style: 'thin', color: { argb: 'FFE4E7ED' } },
        right:  { style: 'thin', color: { argb: 'FFE4E7ED' } }
      };
    });
  });

  // ===== 冻结表头 =====
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  return await workbook.xlsx.writeBuffer();
}

/**
 * 按点号路径取值（支持 a.b.c）
 */
function getByPath(obj, path) {
  if (!path) return undefined;
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/**
 * 生成下载文件名（含日期）
 *
 * @param {string} prefix
 * @returns {string} "xxx_20260512.xlsx"
 */
function buildFilename(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${prefix}_${dateStr}.xlsx`;
}

/**
 * 在 Express res 上输出 Excel（设置好 header）
 */
function sendExcel(res, buffer, filename) {
  const encoded = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`
  );
  res.end(Buffer.from(buffer));
}

module.exports = { buildExcel, buildFilename, sendExcel };
