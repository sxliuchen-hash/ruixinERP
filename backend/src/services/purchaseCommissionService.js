/**
 * ============================================================
 * 采购提成服务（PurchaseCommissionService）
 * ============================================================
 * 职责：
 *   计算采购人员卖出"自营专利"的提成。
 *
 * 【计提口径】（与业务方确认）
 *   - 仅 resource_type='own'（自有/自营）的库存
 *   - status='sold'（已售）
 *   - 提成归属：库存 purchaser_id（采购人员）
 *   - 卖出时间衰减档：按 (卖出日 − 采购日) 落档，发明/实用分别定价
 *   - 档位规则来自 salary_rules.purchase_commission（可编辑）
 *
 * 【发放归属月】
 *   按 sold_time（成交时间）所在月归属，在该月工资条体现。
 *   （采购提成不依赖回款次月规则，成交即计提）
 *
 * 【专利类型归类】
 *   patent_type 含"发明" → invention 档价
 *   含"实用" → utility 档价
 *   其他（外观等）→ 默认按 utility（保守），可后续扩展
 * ============================================================
 */

const { Op } = require('sequelize');
const PatentInventory = require('../models/PatentInventory');
const Employee = require('../models/Employee');
const salaryRuleService = require('./salaryRuleService');

class PurchaseCommissionService {

  /**
   * 计算某采购人某月的采购提成
   * @param {number} employeeId  采购人员（employees.id）
   * @param {number} year
   * @param {number} month
   * @returns {Promise<{total:number, count:number, items:Array}>}
   */
  async getMonthlyCommission(employeeId, year, month) {
    const rule = await salaryRuleService.getPurchaseCommissionRule();
    const tiers = (rule && rule.tiers) || [];

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')} 23:59:59`;

    const list = await PatentInventory.findAll({
      where: {
        purchaser_id: employeeId,
        resource_type: 'own',
        status: 'sold',
        sold_time: { [Op.between]: [startDate, endDate] }
      },
      raw: true
    });

    let total = 0;
    const items = [];

    for (const inv of list) {
      const holdingDays = this._holdingDays(inv);
      const amount = this._matchTierAmount(tiers, holdingDays, inv.patent_type);
      total += amount;
      items.push({
        inventory_id: inv.id,
        patent_no: inv.patent_no,
        patent_name: inv.patent_name,
        patent_type: inv.patent_type,
        purchase_date: inv.purchase_date,
        sold_time: inv.sold_time,
        holding_days: holdingDays,
        commission: amount
      });
    }

    return {
      total: parseFloat(total.toFixed(2)),
      count: items.length,
      items
    };
  }

  /**
   * 采购提成明细报表（按月，全部采购人员）
   * @param {number} year
   * @param {number} month
   * @returns {Promise<Array>} 每个采购人一组
   */
  async getMonthlyReport(year, month) {
    const purchasers = await Employee.findAll({
      where: { role: 'purchase' },
      raw: true
    });

    const result = [];
    for (const emp of purchasers) {
      const data = await this.getMonthlyCommission(emp.id, year, month);
      result.push({
        employee_id: emp.id,
        employee_name: emp.name,
        user_id: emp.user_id,
        commission: data.total,
        sold_count: data.count,
        items: data.items
      });
    }
    return result;
  }

  // ==================== 工具方法 ====================

  /** 持有天数 = 卖出日 − 采购日 */
  _holdingDays(inv) {
    const purchase = inv.purchase_date || inv.stock_in_date;
    const sold = inv.sold_time || inv.stock_out_date;
    if (!purchase || !sold) return 0;
    const p = new Date(purchase).getTime();
    const s = new Date(sold).getTime();
    return Math.max(0, Math.round((s - p) / (24 * 3600 * 1000)));
  }

  /** 按持有天数和专利类型匹配档位金额 */
  _matchTierAmount(tiers, days, patentType) {
    const isInvention = String(patentType || '').includes('发明');
    for (const tier of tiers) {
      const min = tier.days_min ?? 0;
      const max = tier.days_max == null ? Infinity : tier.days_max;
      if (days >= min && days <= max) {
        return parseFloat(isInvention ? (tier.invention || 0) : (tier.utility || 0));
      }
    }
    return 0;
  }
}

module.exports = new PurchaseCommissionService();
