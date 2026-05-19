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
      { header: '专利号*（必填）', key: 'patent_no', width: 22 },
      { header: '专利名称（留空自动从IP系统获取）', key: 'patent_name', width: 32 },
      { header: '专利类型（发明/实用新型/外观，留空自动获取）', key: 'patent_type', width: 28 },
      { header: '技术领域', key: 'tech_field', width: 16 },
      { header: '资源类型（自有/独家代理/共同代理）', key: 'resource_type', width: 22 },
      { header: '代理商名称（代理类型时填写）', key: 'agent_name', width: 22 },
      { header: '分成方式（百分比/固定）', key: 'profit_mode', width: 18 },
      { header: '分成数值（百分比0-100或固定金额）', key: 'profit_value', width: 24 },
      { header: '采购价', key: 'purchase_price', width: 12 },
      { header: '定价（售价）', key: 'current_price', width: 14 },
      { header: '累计维持成本（已有成本直接填入）', key: 'total_maintain_cost', width: 26 },
      { header: '供应商名称', key: 'supplier_name', width: 22 },
      { header: '采购日期（YYYY-MM-DD）', key: 'purchase_date', width: 18 },
      { header: '入库日期（默认今日）', key: 'stock_in_date', width: 18 },
      { header: '报过高企（是/否）', key: 'reported_high_tech', width: 16 },
      { header: '备注', key: 'remark', width: 30 }
    ];

    // 三条示例数据：自有 / 独家代理（百分比）/ 共同代理（固定）
    const rows = [
      {
        patent_no: '2020107848060',
        patent_name: '',
        patent_type: '',
        tech_field: '通信',
        resource_type: '自有',
        agent_name: '',
        profit_mode: '',
        profit_value: '',
        purchase_price: 5000,
        current_price: 12000,
        total_maintain_cost: 1400,
        supplier_name: '示例供应商',
        purchase_date: '2025-01-15',
        stock_in_date: '',
        reported_high_tech: '否',
        remark: '示例：自有专利，已有维持成本1400'
      },
      {
        patent_no: '2021100000001',
        patent_name: '',
        patent_type: '',
        tech_field: '人工智能',
        resource_type: '独家代理',
        agent_name: '示例代理商A',
        profit_mode: '百分比',
        profit_value: 30,
        purchase_price: 0,
        current_price: 20000,
        total_maintain_cost: 0,
        supplier_name: '',
        purchase_date: '',
        stock_in_date: '',
        reported_high_tech: '否',
        remark: '示例：独家代理，代理商分30%'
      },
      {
        patent_no: '2022200000002',
        patent_name: '',
        patent_type: '',
        tech_field: '新材料',
        resource_type: '共同代理',
        agent_name: '示例代理商B',
        profit_mode: '固定',
        profit_value: 5000,
        purchase_price: 0,
        current_price: 18000,
        total_maintain_cost: 600,
        supplier_name: '',
        purchase_date: '',
        stock_in_date: '',
        reported_high_tech: '是',
        remark: '示例：共同代理，代理商固定收5000'
      }
    ];

    const buffer = await buildExcel({
      sheetName: '批量入库模板',
      title: '专利库存批量入库模板（仅"专利号"为必填，其他字段可留空）',
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

    // 调试日志
    const logger = require('../utils/logger');
    logger.info('[BatchImport] 表头检测', {
      headerRowIndex,
      headers: headers.filter(Boolean),
      colMap
    });

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
      const patentNameRaw = this._getCellValue(row, colMap.patent_name);
      const patentTypeRaw = this._getCellValue(row, colMap.patent_type);
      const techFieldRaw = this._getCellValue(row, colMap.tech_field);
      const resourceTypeRaw = this._getCellValue(row, colMap.resource_type);
      const agentNameRaw = this._getCellValue(row, colMap.agent_name);
      const profitModeRaw = this._getCellValue(row, colMap.profit_mode);
      const profitValueRaw = this._getCellValue(row, colMap.profit_value);

      const rowData = {
        rowIndex: i,
        patent_no: String(patentNoRaw).trim().replace(/\s/g, ''),
        patent_name: patentNameRaw ? String(patentNameRaw).trim() : '',
        patent_type: patentTypeRaw ? String(patentTypeRaw).trim() : '',
        tech_field: techFieldRaw ? String(techFieldRaw).trim() : '',
        resource_type: this._parseResourceType(resourceTypeRaw),
        agent_name: agentNameRaw ? String(agentNameRaw).trim() : '',
        profit_rule: this._parseProfitRule(profitModeRaw, profitValueRaw),
        purchase_price: this._parseNumber(this._getCellValue(row, colMap.purchase_price)),
        current_price: this._parseNumber(this._getCellValue(row, colMap.current_price)),
        total_maintain_cost: this._parseNumber(this._getCellValue(row, colMap.total_maintain_cost)),
        supplier_name: this._getCellValue(row, colMap.supplier_name)
          ? String(this._getCellValue(row, colMap.supplier_name)).trim()
          : '',
        purchase_date: this._parseDate(this._getCellValue(row, colMap.purchase_date)),
        stock_in_date: this._parseDate(this._getCellValue(row, colMap.stock_in_date)),
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

      // 资源类型与代理商一致性校验
      if (rowData.resource_type !== 'own') {
        if (!rowData.agent_name) {
          rowErrors.push('代理类型必须填写代理商名称');
        }
        if (!rowData.profit_rule) {
          rowErrors.push('代理类型必须填写分成方式和数值');
        }
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

      // 代理商匹配（共用 suppliers 表）
      if (rowData.agent_name) {
        const agentId = supplierMap.get(rowData.agent_name);
        if (agentId) {
          rowData.agent_id = agentId;
        } else {
          const fuzzyMatch = [...supplierMap.entries()].find(
            ([name]) => name.includes(rowData.agent_name) || rowData.agent_name.includes(name)
          );
          if (fuzzyMatch) {
            rowData.agent_id = fuzzyMatch[1];
            rowData.agent_name_matched = fuzzyMatch[0];
          } else {
            rowData.agent_id = null;
            rowErrors.push(`代理商"${rowData.agent_name}"未找到，入库后需手动关联`);
          }
        }
      }

      if (rowErrors.length > 0) {
        // 供应商/代理商未找到只是警告，不阻断
        const blocking = rowErrors.filter(e =>
          !e.includes('供应商') && !e.includes('代理商')
        );
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

        // 优先使用用户填写的，否则尝试从 IP 系统获取
        let patentName = row.patent_name || '';
        let patentType = row.patent_type || null;
        let ipFetched = false;

        const needIpFetch = !patentName || !patentType;
        if (needIpFetch) {
          try {
            const ipData = await ipSystemService.getPatentFeeDetail(row.patent_no, req);
            if (ipData && ipData.patent) {
              if (!patentName) patentName = ipData.patent.patentName || row.patent_no;
              if (!patentType) patentType = ipData.patent.patentType || null;
              ipFetched = true;
            }
          } catch (ipErr) {
            // IP 系统查询失败不阻断入库
            logger.warn(`批量入库: IP 系统查询 ${row.patent_no} 失败: ${ipErr.message}`);
          }
        }

        // 兜底：若 patentName 仍为空，用专利号
        if (!patentName) patentName = row.patent_no;

        // 入库日期：用户填写优先，否则取今日
        const stockInDate = row.stock_in_date || new Date().toISOString().slice(0, 10);

        await PatentInventory.create({
          patent_no: row.patent_no,
          patent_name: patentName,
          patent_type: patentType,
          tech_field: row.tech_field || null,
          resource_type: row.resource_type || 'own',
          agent_id: row.agent_id || null,
          profit_rule: row.profit_rule || null,
          purchase_price: row.purchase_price || 0,
          current_price: row.current_price || 0,
          total_maintain_cost: row.total_maintain_cost || 0,
          purchase_date: row.purchase_date || null,
          supplier_id: row.supplier_id || null,
          stock_in_date: stockInDate,
          status: 'in_stock',
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
          message: ipFetched
            ? '入库成功（IP 系统补全信息）'
            : (needIpFetch ? '入库成功（IP 信息待补全）' : '入库成功')
        });

        // IP 系统频率限制：仅在调用了 IP 系统时才需要等待
        if (needIpFetch && validRows.indexOf(row) < validRows.length - 1) {
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
   *
   * 【匹配策略】
   *   按"最具特征的关键词优先"原则，长关键词先匹配，避免短关键词覆盖
   *   例如"资源类型"必须先匹配，否则会被"类型"误匹配到 patent_type
   */
  _mapColumns(headers) {
    const map = {
      patent_no: null,
      patent_name: null,
      patent_type: null,
      tech_field: null,
      resource_type: null,
      agent_name: null,
      profit_mode: null,
      profit_value: null,
      total_maintain_cost: null,
      purchase_price: null,
      current_price: null,
      supplier_name: null,
      purchase_date: null,
      stock_in_date: null,
      reported_high_tech: null,
      remark: null
    };

    headers.forEach((h, idx) => {
      if (!h) return;
      const text = String(h).trim();

      // 严格匹配：长短语优先
      // 1. 资源类型相关（必须早于"类型"）
      if (text.includes('资源类型') || text.includes('资源分类')) {
        map.resource_type = idx;
        return;
      }
      if (text.includes('代理商')) {
        map.agent_name = idx;
        return;
      }
      if (text.includes('分成方式')) {
        map.profit_mode = idx;
        return;
      }
      if (text.includes('分成数值') || text.includes('分成比例') || text.includes('分成金额')) {
        map.profit_value = idx;
        return;
      }

      // 2. 专利相关
      if (text.includes('专利号')) {
        map.patent_no = idx;
        return;
      }
      if (text.includes('专利名称') || (text.includes('名称') && !text.includes('代理') && !text.includes('供应'))) {
        map.patent_name = idx;
        return;
      }
      if (text.includes('专利类型') || text.includes('发明/实用') || text === '类型') {
        map.patent_type = idx;
        return;
      }

      // 3. 技术领域
      if (text.includes('技术领域') || text === '领域') {
        map.tech_field = idx;
        return;
      }

      // 4. 价格/成本
      if (text.includes('累计维持成本') || text.includes('维持成本')) {
        map.total_maintain_cost = idx;
        return;
      }
      if (text.includes('采购价') || (text.includes('成本') && !text.includes('维持'))) {
        map.purchase_price = idx;
        return;
      }
      if (text.includes('定价') || text.includes('售价') || text.includes('现价')) {
        map.current_price = idx;
        return;
      }

      // 5. 供应商
      if (text.includes('供应商')) {
        map.supplier_name = idx;
        return;
      }

      // 6. 日期
      if (text.includes('采购日') || text.includes('采购时间')) {
        map.purchase_date = idx;
        return;
      }
      if (text.includes('入库日') || text.includes('入库时间')) {
        map.stock_in_date = idx;
        return;
      }

      // 7. 其他
      if (text.includes('高企') || text.includes('高新')) {
        map.reported_high_tech = idx;
        return;
      }
      if (text.includes('备注')) {
        map.remark = idx;
        return;
      }
    });

    return map;
  }

  /**
   * 解析资源类型（中英文映射）
   */
  _parseResourceType(val) {
    if (!val) return 'own';
    const str = String(val).trim();
    if (str === '自有' || str === 'own') return 'own';
    if (str === '独家代理' || str === 'exclusive_agent') return 'exclusive_agent';
    if (str === '共同代理' || str === 'joint_agent') return 'joint_agent';
    return 'own'; // 默认自有
  }

  /**
   * 解析分成规则
   */
  _parseProfitRule(modeVal, valueVal) {
    if (!modeVal) return null;
    const mode = String(modeVal).trim();
    const value = parseFloat(valueVal);
    if (isNaN(value) || value < 0) return null;

    if (mode === '百分比' || mode === 'percent') {
      return { mode: 'percent', agent_share_pct: Math.min(100, value) };
    }
    if (mode === '固定' || mode === 'fixed') {
      return { mode: 'fixed', agent_fixed_fee: value };
    }
    return null;
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
