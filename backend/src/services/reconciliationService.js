/**
 * ============================================================
 * 银行对账业务服务（ReconciliationService）
 * ============================================================
 *
 * 【核心流程】
 *   1) 上传 Excel + 字段映射 → 解析为 bank_statements 行
 *   2) 自动匹配算法：
 *      a. 精确匹配：金额完全相同 + 日期 ±1 天
 *      b. 模糊匹配：金额完全相同 + 日期 ±3 天 + 摘要相似度
 *      c. 给每条流水计算 match_score（0-100）
 *   3) 对账结果：
 *      - matched ：流水和 payment 已配对
 *      - unmatched ：流水有但 payments 无（常见：漏记 / 费用类未录）
 *      - extra ：payments 有但流水无（常见：跨行转账 / 待到账）
 *   4) 用户可：
 *      - 从未匹配流水一键创建 payment（自动带入金额/日期/摘要）
 *      - 手动匹配（指定 statement → payment）
 *      - 标记为 ignored
 *
 * 【自动归类建议】
 *   T13 自动归类还没做，这里先用 classify_rules 表做关键词匹配，
 *   给 unmatched 流水附上 suggested_category_id。
 *
 * 【解析 Excel】
 *   支持灵活字段映射：前端上传时传入 columnMap:
 *     { trans_date: 'A', amount_income: 'B', amount_expense: 'C',
 *       summary: 'D', counterparty: 'E' }
 *   amount_income / amount_expense 二选一或都填（各银行格式不同）
 *
 * 【事务安全】
 *   同一次上传使用同一 batch_no，出错整批回滚
 * ============================================================
 */

const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const BankStatement = require('../models/BankStatement');
const BankAccount = require('../models/BankAccount');
const Payment = require('../models/Payment');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const logger = require('../utils/logger');

/** 精确匹配日期容差（天） */
const EXACT_DATE_TOLERANCE = 1;
/** 模糊匹配日期容差（天） */
const FUZZY_DATE_TOLERANCE = 3;

class ReconciliationService {
  /**
   * 上传 Excel 并解析 + 自动匹配
   *
   * @param {Buffer} fileBuffer  Excel 二进制
   * @param {Object} options
   * @param {number} options.account_id   对账账户 ID（必填）
   * @param {Object} options.columnMap    列映射 {trans_date, amount, amount_income, amount_expense, summary, counterparty}
   * @param {number} [options.headerRow=1] 表头所在行（从 1 开始），数据从 headerRow+1 开始
   * @param {string} [options.sheetName]  指定工作表（默认第一个）
   * @param {number} userId               上传人 ID
   * @returns {Promise<{batch_no, total, inserted, auto_matched}>}
   */
  async uploadStatement(fileBuffer, options, userId) {
    const { account_id, columnMap, headerRow, sheetName } = options;

    if (!account_id) throw new ValidationError('请选择对账账户');
    if (!columnMap) throw new ValidationError('请配置列映射');

    const account = await BankAccount.findByPk(account_id);
    if (!account) throw new NotFoundError('账户不存在');

    // ===== 解析 Excel =====
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!sheet) throw new ValidationError('Excel 工作表为空');

    const rows = this._parseRows(sheet, columnMap, headerRow || 1);
    if (!rows.length) {
      throw new ValidationError('未从 Excel 解析到任何有效行，请检查列映射');
    }

    // ===== 生成批次号 =====
    const batchNo = 'BS' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
      + '_' + crypto.randomBytes(3).toString('hex');

    // ===== 事务批量写入 =====
    const result = await sequelize.transaction(async (t) => {
      const created = [];
      for (const r of rows) {
        const statement = await BankStatement.create({
          account_id,
          batch_no: batchNo,
          trans_date: r.trans_date,
          amount: r.amount,
          balance: r.balance,
          summary: r.summary,
          counterparty: r.counterparty,
          match_status: 'unmatched',
          created_by: userId
        }, { transaction: t });
        created.push(statement);
      }
      return created;
    });

    // ===== 自动匹配（事务外，每条独立写） =====
    let autoMatched = 0;
    for (const st of result) {
      const match = await this._findMatch(st);
      if (match.payment) {
        await st.update({
          match_status: 'matched',
          matched_payment_id: match.payment.id,
          match_score: match.score
        });
        autoMatched++;
      } else {
        // 给 unmatched 流水做归类建议
        const categoryId = await this._suggestCategory(st.summary);
        if (categoryId) {
          await st.update({ suggested_category_id: categoryId });
        }
      }
    }

    logger.info('[Reconciliation] 上传完成', {
      batch_no: batchNo,
      total: rows.length,
      auto_matched: autoMatched
    });

    return {
      batch_no: batchNo,
      total: rows.length,
      inserted: result.length,
      auto_matched: autoMatched
    };
  }

  /**
   * 获取对账结果（按批次）
   *
   * 返回三栏：
   *   - matched      ：已匹配的流水（附带 payment 信息）
   *   - unmatched    ：未匹配的流水
   *   - extra        ：流水期内 payments 有但流水表无对应的记录
   *   - summary      ：统计数字
   */
  async getResult(batchNo) {
    const statements = await BankStatement.findAll({
      where: { batch_no: batchNo },
      include: [
        { model: BankAccount, as: 'account', attributes: ['id', 'name', 'account_type'] },
        { model: Payment, as: 'matchedPayment', attributes: [
            'id', 'type', 'category', 'amount', 'payment_date',
            'summary', 'contract_id', 'customer_id', 'supplier_id'
          ]
        }
      ],
      order: [['trans_date', 'ASC'], ['id', 'ASC']]
    });

    if (!statements.length) {
      throw new NotFoundError('对账批次不存在');
    }

    const accountId = statements[0].account_id;
    const matched = statements.filter(s => s.match_status === 'matched');
    const unmatched = statements.filter(s => s.match_status === 'unmatched');
    const ignored = statements.filter(s => s.match_status === 'ignored');

    // 查询"extra"：流水期内的 payments，但不在已匹配集合中
    const dates = statements.map(s => s.trans_date).filter(Boolean);
    const startDate = dates.length ? dates.reduce((a, b) => a < b ? a : b) : null;
    const endDate = dates.length ? dates.reduce((a, b) => a > b ? a : b) : null;

    let extra = [];
    if (startDate && endDate) {
      const matchedIds = matched.map(s => s.matched_payment_id).filter(Boolean);
      // 扩展 ±FUZZY_DATE_TOLERANCE 天，避免边界漏判
      const startExtended = new Date(startDate);
      startExtended.setDate(startExtended.getDate() - FUZZY_DATE_TOLERANCE);
      const endExtended = new Date(endDate);
      endExtended.setDate(endExtended.getDate() + FUZZY_DATE_TOLERANCE);

      const extraPayments = await Payment.findAll({
        where: {
          account_id: accountId,
          confirm_status: 'confirmed',
          payment_date: {
            [Op.between]: [
              startExtended.toISOString().slice(0, 10),
              endExtended.toISOString().slice(0, 10)
            ]
          },
          ...(matchedIds.length ? { id: { [Op.notIn]: matchedIds } } : {})
        },
        attributes: [
          'id', 'type', 'category', 'amount', 'payment_date',
          'summary', 'contract_id', 'customer_id', 'supplier_id'
        ],
        order: [['payment_date', 'ASC']]
      });
      extra = extraPayments;
    }

    return {
      batch_no: batchNo,
      account_id: accountId,
      period: { start: startDate, end: endDate },
      summary: {
        total: statements.length,
        matched: matched.length,
        unmatched: unmatched.length,
        ignored: ignored.length,
        extra: extra.length
      },
      matched,
      unmatched,
      ignored,
      extra
    };
  }

  /**
   * 对账历史（按批次聚合）
   */
  async getHistory(query) {
    const { page, limit, offset } = parsePagination(query);
    const { account_id } = query;

    const whereParts = [];
    const replacements = { limit, offset };
    if (account_id) {
      whereParts.push('s.account_id = :account_id');
      replacements.account_id = parseInt(account_id, 10);
    }
    const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

    // 每个批次一行，聚合出关键统计
    const rows = await sequelize.query(
      `SELECT
         s.batch_no,
         s.account_id,
         a.name AS account_name,
         MIN(s.trans_date) AS start_date,
         MAX(s.trans_date) AS end_date,
         COUNT(*) AS total,
         SUM(CASE WHEN s.match_status='matched' THEN 1 ELSE 0 END) AS matched,
         SUM(CASE WHEN s.match_status='unmatched' THEN 1 ELSE 0 END) AS unmatched,
         SUM(CASE WHEN s.match_status='ignored' THEN 1 ELSE 0 END) AS ignored,
         MIN(s.create_time) AS create_time,
         s.created_by
       FROM bank_statements s
       LEFT JOIN bank_accounts a ON a.id = s.account_id
       ${whereSql}
       GROUP BY s.batch_no, s.account_id, a.name, s.created_by
       ORDER BY create_time DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    const [countRow] = await sequelize.query(
      `SELECT COUNT(DISTINCT batch_no) AS total
       FROM bank_statements s
       ${whereSql}`,
      { replacements, type: QueryTypes.SELECT }
    );

    return {
      list: rows.map(r => ({
        batch_no: r.batch_no,
        account_id: r.account_id,
        account_name: r.account_name,
        start_date: r.start_date,
        end_date: r.end_date,
        total: parseInt(r.total, 10),
        matched: parseInt(r.matched, 10),
        unmatched: parseInt(r.unmatched, 10),
        ignored: parseInt(r.ignored, 10),
        create_time: r.create_time,
        created_by: r.created_by
      })),
      pagination: {
        page,
        limit,
        total: parseInt(countRow.total, 10),
        totalPages: Math.ceil(parseInt(countRow.total, 10) / limit)
      }
    };
  }

  /**
   * 从一条未匹配流水创建 payment
   *
   * 自动带入：
   *   - type：amount > 0 → income，否则 expense
   *   - amount：取绝对值
   *   - payment_date：trans_date
   *   - account_id / summary：沿用流水
   *
   * @param {number} statementId
   * @param {Object} extra  用户补充的字段（category / contract_id / cost_category_id / customer_id 等）
   * @param {number} userId
   */
  async createPaymentFromStatement(statementId, extra, userId) {
    const st = await BankStatement.findByPk(statementId);
    if (!st) throw new NotFoundError('流水记录不存在');
    if (st.match_status === 'matched') {
      throw new ValidationError('该流水已匹配 payment，不可重复创建');
    }

    const amount = Math.abs(parseFloat(st.amount) || 0);
    if (amount <= 0) throw new ValidationError('流水金额非法，无法创建付款记录');

    const type = parseFloat(st.amount) > 0 ? 'income' : 'expense';
    const category = extra.category || 'fee'; // 默认费用类（业务类需关联合同，用户补充）

    if (category === 'business' && !extra.contract_id) {
      throw new ValidationError('业务类收付款必须关联合同');
    }

    // 复用 paymentService 的创建逻辑（含合同 paid_amount 联动、cost_record 同步）
    const paymentService = require('./paymentService');
    const payment = await paymentService.create({
      type,
      category,
      amount,
      payment_date: st.trans_date,
      payment_method: 'transfer',
      account_id: st.account_id,
      summary: extra.summary || st.summary || '',
      remark: extra.remark || `来源流水批次 ${st.batch_no}`,
      contract_id: extra.contract_id || null,
      customer_id: extra.customer_id || null,
      supplier_id: extra.supplier_id || null,
      project_id: extra.project_id || null,
      cost_category_id: extra.cost_category_id || st.suggested_category_id || null,
      confirm_status: 'confirmed'
    }, userId);

    // 绑定流水 ↔ payment
    await st.update({
      match_status: 'matched',
      matched_payment_id: payment.id,
      match_score: 100 // 手动创建视为精确匹配
    });

    return { statement: st, payment };
  }

  /**
   * 手动匹配：指定流水与 payment
   */
  async manualMatch(statementId, paymentId) {
    const st = await BankStatement.findByPk(statementId);
    if (!st) throw new NotFoundError('流水记录不存在');

    const p = await Payment.findByPk(paymentId);
    if (!p) throw new NotFoundError('付款记录不存在');

    // 防重复占用：该 payment 不能已被其他流水匹配（自动匹配已排除，手动匹配此前缺失该校验）
    const occupied = await BankStatement.findOne({
      where: {
        matched_payment_id: paymentId,
        match_status: 'matched',
        id: { [Op.ne]: statementId }
      }
    });
    if (occupied) {
      throw new ValidationError(`该付款已被流水 #${occupied.id} 匹配，不能重复匹配`);
    }

    // 基本合理性校验：账户一致、金额匹配
    if (p.account_id !== st.account_id) {
      throw new ValidationError('付款账户与流水账户不一致');
    }
    const stAmt = Math.abs(parseFloat(st.amount));
    const pAmt = parseFloat(p.amount);
    if (Math.abs(stAmt - pAmt) > 0.01) {
      throw new ValidationError(`金额不符：流水 ${stAmt}，付款 ${pAmt}`);
    }

    await st.update({
      match_status: 'matched',
      matched_payment_id: p.id,
      match_score: 90 // 手动匹配默认 90
    });
    return st;
  }

  /**
   * 解除匹配
   */
  async unmatch(statementId) {
    const st = await BankStatement.findByPk(statementId);
    if (!st) throw new NotFoundError('流水记录不存在');
    if (st.match_status !== 'matched') {
      throw new ValidationError('该流水未处于匹配状态');
    }
    await st.update({
      match_status: 'unmatched',
      matched_payment_id: null,
      match_score: null
    });
    return st;
  }

  /**
   * 忽略一条流水（跨行转账等情况）
   */
  async ignore(statementId) {
    const st = await BankStatement.findByPk(statementId);
    if (!st) throw new NotFoundError('流水记录不存在');
    if (st.match_status === 'matched') {
      throw new ValidationError('已匹配的流水请先解除匹配再忽略');
    }
    await st.update({ match_status: 'ignored' });
    return st;
  }

  /**
   * 删除对账批次（级联删除所有该批次的流水）
   *
   * 注意：已匹配的流水删除后，对应的 payment 保留（单据独立）
   */
  async deleteBatch(batchNo) {
    const count = await BankStatement.count({ where: { batch_no: batchNo } });
    if (!count) throw new NotFoundError('批次不存在');
    await BankStatement.destroy({ where: { batch_no: batchNo } });
    return { batch_no: batchNo, deleted: count };
  }

  // ==================== 私有工具 ====================

  /**
   * 【私有】解析 Excel 行
   *
   * @param {ExcelJS.Worksheet} sheet
   * @param {Object} columnMap 列映射（字段名 → 列字母，如 {trans_date: 'A'}）
   * @param {number} headerRow
   */
  _parseRows(sheet, columnMap, headerRow) {
    const rows = [];

    // 列字母 → 数字索引（A=1, B=2, ...）
    const colIdx = (letter) => {
      if (!letter) return null;
      if (typeof letter === 'number') return letter;
      const s = String(letter).trim().toUpperCase();
      if (!/^[A-Z]+$/.test(s)) return null;
      let n = 0;
      for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64);
      return n;
    };

    const map = {};
    for (const [k, v] of Object.entries(columnMap || {})) {
      map[k] = colIdx(v);
    }

    const readCell = (row, col) => {
      if (!col) return null;
      const cell = row.getCell(col);
      if (!cell || cell.value == null) return null;
      return cell.value;
    };

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRow) return; // 跳过表头

      const rawDate = readCell(row, map.trans_date);
      const rawAmount = readCell(row, map.amount);
      const rawIncome = readCell(row, map.amount_income);
      const rawExpense = readCell(row, map.amount_expense);
      const rawBalance = readCell(row, map.balance);
      const rawSummary = readCell(row, map.summary);
      const rawCp = readCell(row, map.counterparty);

      // ===== 日期解析 =====
      const transDate = this._parseDate(rawDate);

      // ===== 金额解析（优先级：amount > income - expense）=====
      let amount;
      if (rawAmount !== null) {
        amount = this._parseNumber(rawAmount);
      } else {
        const income = this._parseNumber(rawIncome) || 0;
        const expense = this._parseNumber(rawExpense) || 0;
        amount = income - expense;
      }

      // 非法数据跳过（整行为空也在这跳过）
      if (!transDate || amount === null || amount === undefined || isNaN(amount) || amount === 0) {
        return;
      }

      rows.push({
        trans_date: transDate,
        amount: parseFloat(amount.toFixed(2)),
        balance: this._parseNumber(rawBalance),
        summary: this._cellToText(rawSummary),
        counterparty: this._cellToText(rawCp)
      });
    });

    return rows;
  }

  /**
   * 【私有】日期转换：支持 Excel Date 对象 / 字符串 / 数字序列
   */
  _parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
      // Excel 序列号日期（1900 系统）
      const d = new Date((value - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(value).trim().replace(/[./]/g, '-');
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    // 尝试原生解析
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }

  /**
   * 【私有】数字解析（去除逗号/货币符号）
   */
  _parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value.result !== undefined) {
      return parseFloat(value.result);
    }
    const s = String(value).replace(/[,¥$\s]/g, '').replace(/[()]/g, '-');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /** 【私有】富文本 cell 转普通字符串 */
  _cellToText(value) {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object') {
      if (value.richText) {
        return value.richText.map(r => r.text).join('');
      }
      if (value.text) return String(value.text);
    }
    return String(value);
  }

  /**
   * 【私有】在 payments 中查找匹配
   *
   * 规则：
   *   1) 已被其他 statement 匹配的 payment 排除
   *   2) 账户一致
   *   3) confirm_status='confirmed'
   *   4) 金额完全相等（绝对值）+ type 方向一致（流水正=income / 负=expense）
   *   5) 日期容差分两档：±1 天（精确 100 分）/ ±3 天（模糊，按摘要相似度扣分）
   *
   * @returns {Promise<{payment: Payment|null, score: number}>}
   */
  async _findMatch(statement) {
    const amount = parseFloat(statement.amount);
    const absAmount = Math.abs(amount).toFixed(2);
    const type = amount > 0 ? 'income' : 'expense';

    const transDate = new Date(statement.trans_date);
    const fuzzyStart = new Date(transDate);
    fuzzyStart.setDate(fuzzyStart.getDate() - FUZZY_DATE_TOLERANCE);
    const fuzzyEnd = new Date(transDate);
    fuzzyEnd.setDate(fuzzyEnd.getDate() + FUZZY_DATE_TOLERANCE);

    // 候选 payments：账户、金额、方向、confirmed，未被其他 statement 匹配
    const candidates = await Payment.findAll({
      where: {
        account_id: statement.account_id,
        type,
        amount: absAmount,
        confirm_status: 'confirmed',
        payment_date: {
          [Op.between]: [
            fuzzyStart.toISOString().slice(0, 10),
            fuzzyEnd.toISOString().slice(0, 10)
          ]
        }
      }
    });

    // 排除已被其他 statement 匹配的 payment
    const candidateIds = candidates.map(c => c.id);
    if (!candidateIds.length) return { payment: null, score: 0 };

    const usedRows = await BankStatement.findAll({
      where: {
        matched_payment_id: { [Op.in]: candidateIds },
        match_status: 'matched',
        id: { [Op.ne]: statement.id }
      },
      attributes: ['matched_payment_id']
    });
    const usedIds = new Set(usedRows.map(r => r.matched_payment_id));

    const available = candidates.filter(c => !usedIds.has(c.id));
    if (!available.length) return { payment: null, score: 0 };

    // 逐个算分，取最高分
    let best = null;
    for (const p of available) {
      const score = this._scoreMatch(statement, p);
      if (!best || score > best.score) {
        best = { payment: p, score };
      }
    }

    // 分数阈值：小于 60 不算匹配（避免误匹配）
    if (best.score < 60) return { payment: null, score: best.score };
    return best;
  }

  /**
   * 【私有】算分
   *   - 金额匹配：必要条件（已在候选过滤）
   *   - 日期差 0 天 +50，1 天 +40，2 天 +25，3 天 +10
   *   - 摘要相似度 * 50（bigram）
   */
  _scoreMatch(statement, payment) {
    let score = 0;

    const d1 = new Date(statement.trans_date);
    const d2 = new Date(payment.payment_date);
    const dayDiff = Math.abs(Math.round((d1 - d2) / 86400000));
    if (dayDiff === 0) score += 50;
    else if (dayDiff === 1) score += 40;
    else if (dayDiff === 2) score += 25;
    else if (dayDiff <= 3) score += 10;

    const simi = this._stringSimilarity(
      String(statement.summary || '') + (statement.counterparty ? ' ' + statement.counterparty : ''),
      String(payment.summary || '')
    );
    score += Math.round(simi * 50);

    return Math.min(100, score);
  }

  /**
   * 【私有】字符串相似度（bigram 交集 / 并集）
   */
  _stringSimilarity(a, b) {
    const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
    const sa = norm(a);
    const sb = norm(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 1;

    const bigrams = (s) => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const A = bigrams(sa);
    const B = bigrams(sb);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    return (2.0 * inter) / (A.size + B.size);
  }

  /**
   * 【私有】根据摘要建议成本类别（classify_rules 表）
   */
  async _suggestCategory(summary) {
    if (!summary) return null;
    try {
      const rules = await sequelize.query(
        `SELECT category_id, keyword, priority FROM classify_rules
         WHERE status = 1
         ORDER BY priority DESC, id ASC`,
        { type: QueryTypes.SELECT }
      );
      for (const r of rules) {
        if (summary.includes(r.keyword)) {
          return r.category_id;
        }
      }
    } catch (e) {
      // classify_rules 不存在时静默
    }
    return null;
  }
}

module.exports = new ReconciliationService();
