/**
 * ============================================================
 * 专利库存批量导入服务（InventoryBatchService）
 * ============================================================
 *
 * 【业务流程】
 *   1. 用户上传 Excel（专利号、采购价、定价、供应商、采购时间、是否报过高企、备注）
 *   2. 后端解析 → 校验 → 返回预览（valid + errors）
 *   3. 用户确认 → 后端逐条入库，同时调用 IP 系统获取专利详情（名称、类型等）
 *
 * 【设计要点】
 *   - 专利号为必填，其他字段可选
 *   - 专利名称、类型等由 IP 系统接口自动补全
 *   - 供应商支持按名称匹配（模糊匹配第一个，或自动创建）
 *   - 已存在的专利号跳过（不覆盖）
 *   - IP 系统查询失败不阻断入库，仅标记为"待补全"
 * ============================================================
 */

const ExcelJS = require('exceljs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const PatentInventory = require('../models/PatentInventory');
const Supplier = require('../models/Supplier');
const ipSystemService = require('./ipSystemService');
const { buildExcel, buildFilename } = require('../utils/excelHelper');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class InventoryBatchService {
  /**
   * 生成批量导入模板
   * @returns {{ buffer: Buffer, filename: string }}
   */
  async generateTemplate() {
    const columns = [
      { header: '专利号（必填）', key: 'patent_no', width: 22 },
      { header: '采购价', key: 'purchase_price', width: 12 },
      { header: '定价（售价）', key: 'current_price', width: 12 },
      { header: '供应商名称', key: 'supplier_name', width: 24 },
      { header: '采购日期', key: 'purchase_date', width: 14 },
      { header: '是否报过高企（是/否）', key: 'reported_high_tech', width: 20 },
      { header: '备注', key: 'remark', width: 30 }
    ];

    // 示例数据
    const rows = [
      {
        patent_no: '2020107848060',
        purchase_price: 5000,
        current_price: 12000,
        supplier_name: '示例供应商',
        purchase_date: '2025-01-15',
        reported_high_tech: '否',
        remark: '示例数据，请删除后填写'
      }
    ];

    const buffer = await buildExcel({
      sheetName: '批量入库模板',
      title: '专利库存批量入库模板',
      columns,
      rows
    });

    return { buffer, filename: buildFilename('专利批量入库模板') };
  }

  /**
   * 解析并校验上传的 Excel 文件
   * @param {Buffer} fileBuffer - Excel 文件 buffer
   * @returns {{ total, valid, errors }}
   */
  async parseAndValidate(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ValidationError('Excel 文件中没有工作表');
    }

    // 查找表头行（跳过可能的标题行）
    let headerRowIndex = 1;
    const firstCell = sheet.getRow(1).getCell(1).value;
    if (firstCell && String(firstCell).includes('模板')) {
      headerRowIndex = 2;
    }

    const headerRow = sheet.getRow(headerRowIndex);
    const headers = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value || '').trim();
    });

    // 映射列索引
    const colMap = this._mapColumns(headers);

    // 解析数据行
    const valid = [];
    const errors = [];
    let total = 0;

    // 预加载所有已存在的专利号
    const existingPatents = await PatentInventory.findAll({
      attributes: ['patent_no'],
      raw: true
    });
    const existingSet = new Set(existingPatents.map(p => p.patent_no));

    // 预加载供应商（按名称索引）
    const suppliers = await Supplier.findAll({ attributes: ['id', 'name'], raw: true });
    const supplierMap = new Map(suppliers.map(s => [s.name, s.id]));

    for (let i = headerRowIndex + 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      // 跳过空行
      const patentNoRaw = this._getCellValue(row, colMap.patent_no);
      if (!patentNoRaw) continue;

      total++;
      const rowData = {
        rowIndex: i,
        patent_no: String(patentNoRaw).trim().replace(/\s/g, ''),
        purchase_price: this._parseNumber(this._getCellValue(row, colMap.purchase_price)),
        current_price: this._parseNumber(this._getCellValue(row, colMap.current_price)),
        supplier_name: this._getCellValue(row, colMap.supplier_name)
          ? String(this._getCellValue(row, colMap.supplier_name)).trim()
          : '',
        purchase_date: this._parseDate(this._getCellValue(row, colMap.purchase_date)),
        reported_high_tech: this._parseBoolean(this._getCellValue(row, colMap.reported_high_tech)),
        remark: this._getCellValue(row, colMap.remark)
          ? String(this._getCellValue(row, colMap.remark)).trim()
          : ''
      };

      // 校验
      const rowErrors = [];

      // 专利号格式校验（允许数字和X）
      if (!rowData.patent_no) {
        rowErrors.push('专利号不能为空');
      } else if (!/^[\dX]{10,20}$/i.test(rowData.patent_no)) {
        rowErrors.push(`专利号格式异常: ${rowData.patent_no}`);
      }

      // 重复检查
      if (rowData.patent_no && existingSet.has(rowData.patent_no)) {
        rowErrors.push(`专利号 ${rowData.patent_no} 已存在于库存中`);
      }

      // 供应商匹配
      if (rowData.supplier_name) {
        const supplierId = supplierMap.get(rowData.supplier_name);
        if (supplierId) {
          rowData.supplier_id = supplierId;
        } else {
          // 模糊匹配
          const fuzzyMatch = [...supplierMap.entries()].find(
            ([name]) => name.includes(rowData.supplier_name) || rowData.supplier_name.includes(name)
          );
          if (fuzzyMatch) {
            rowData.supplier_id = fuzzyMatch[1];
            rowData.supplier_name_matched = fuzzyMatch[0];
          } else {
            rowData.supplier_id = null;
            rowErrors.push(`供应商"${rowData.supplier_name}"未找到，入库后需手动关联`);
          }
        }
      }

      if (rowErrors.length > 0) {
        // 供应商未找到只是警告，不阻断
        const blocking = rowErrors.filter(e => !e.includes('供应商'));
        if (blocking.length > 0) {
          errors.push({ ...rowData, errors: rowErrors });
        } else {
          rowData.warnings = rowErrors;
          valid.push(rowData);
        }
      } else {
        valid.push(rowData);
      }
    }

    return { total, valid, errors };
  }

  /**
   * 执行批量入库
   * @param {Array} validRows - 校验通过的行数据
   * @param {number} userId - 当前用户 ID
   * @param {import('express').Request} req - Express 请求对象（用于 IP 系统认证）
   * @returns {{ imported, skipped, failed, details }}
   */
  async batchImport(validRows, userId, req) {
    if (!validRows || validRows.length === 0) {
      throw new ValidationError('没有可导入的数据');
    }

    const results = {
      imported: 0,
      skipped: 0,
      failed: 0,
      details: []
    };

    for (const row of validRows) {
      try {
        // 再次检查是否已存在（防止并发）
        const existing = await PatentInventory.findOne({
          where: { patent_no: row.patent_no }
        });
        if (existing) {
          results.skipped++;
          results.details.push({
            patent_no: row.patent_no,
            status: 'skipped',
            message: '已存在'
          });
          continue;
        }

        // 尝试从 IP 系统获取专利详情
        let patentName = row.patent_no; // 默认用专利号作为名称
        let patentType = null;
        let ipFetched = false;

        try {
          const ipData = await ipSystemService.getPatentFeeDetail(row.patent_no, req);
          if (ipData && ipData.patent) {
            patentName = ipData.patent.patentName || patentName;
            patentType = ipData.patent.patentType || null;
            ipFetched = true;
          }
        } catch (ipErr) {
          // IP 系统查询失败不阻断入库
          logger.warn(`批量入库: IP 系统查询 ${row.patent_no} 失败: ${ipErr.message}`);
        }

        // 入库
        const today = new Date().toISOString().slice(0, 10);
        await PatentInventory.create({
          patent_no: row.patent_no,
          patent_name: patentName,
          patent_type: patentType,
          purchase_price: row.purchase_price || 0,
          current_price: row.current_price || 0,
          purchase_date: row.purchase_date || null,
          supplier_id: row.supplier_id || null,
          stock_in_date: today,
          status: 'in_stock',
          total_maintain_cost: 0,
          reported_high_tech: row.reported_high_tech || false,
          remark: row.remark || null,
          created_by: userId
        });

        results.imported++;
        results.details.push({
          patent_no: row.patent_no,
          patent_name: patentName,
          status: 'imported',
          ip_fetched: ipFetched,
          message: ipFetched ? '入库成功（已获取专利信息）' : '入库成功（专利信息待补全）'
        });

        // IP 系统频率限制：间隔 600ms
        if (validRows.indexOf(row) < validRows.length - 1) {
          await this._sleep(600);
        }
      } catch (err) {
        results.failed++;
        results.details.push({
          patent_no: row.patent_no,
          status: 'failed',
          message: err.message || '入库失败'
        });
        logger.error(`批量入库失败 ${row.patent_no}:`, err.message);
      }
    }

    return results;
  }

  // ==================== 私有工具 ====================

  /**
   * 映射 Excel 列头到字段
   */
  _mapColumns(headers) {
    const map = {
      patent_no: null,
      purchase_price: null,
      current_price: null,
      supplier_name: null,
      purchase_date: null,
      reported_high_tech: null,
      remark: null
    };

    headers.forEach((h, idx) => {
      if (!h) return;
      const lower = h.toLowerCase();
      if (lower.includes('专利号')) map.patent_no = idx;
      else if (lower.includes('采购价') || lower.includes('成本')) map.purchase_price = idx;
      else if (lower.includes('定价') || lower.includes('售价') || lower.includes('现价')) map.current_price = idx;
      else if (lower.includes('供应商')) map.supplier_name = idx;
      else if (lower.includes('采购日') || lower.includes('采购时间')) map.purchase_date = idx;
      else if (lower.includes('高企') || lower.includes('高新')) map.reported_high_tech = idx;
      else if (lower.includes('备注')) map.remark = idx;
    });

    return map;
  }

  _getCellValue(row, colIndex) {
    if (!colIndex) return null;
    const cell = row.getCell(colIndex);
    if (!cell || cell.value === null || cell.value === undefined) return null;
    // ExcelJS 可能返回 richText 对象
    if (typeof cell.value === 'object' && cell.value.richText) {
      return cell.value.richText.map(r => r.text).join('');
    }
    if (typeof cell.value === 'object' && cell.value.result !== undefined) {
      return cell.value.result;
    }
    return cell.value;
  }

  _parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  _parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
      return val.toISOString().slice(0, 10);
    }
    const str = String(val).trim();
    // 尝试解析常见日期格式
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    // 尝试 YYYYMMDD 格式
    if (/^\d{8}$/.test(str)) {
      return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
    }
    return null;
  }

  _parseBoolean(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim().toLowerCase();
    return ['是', 'yes', 'true', '1', 'y'].includes(str);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new InventoryBatchService();
