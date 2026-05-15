/**
 * ============================================================
 * 薪资规则服务（SalaryRuleService）
 * ============================================================
 * 管理薪资计算规则的 CRUD + 初始化默认规则。
 *
 * 规则类型：
 *   - commission: 销售提成阶梯
 *   - grade: 职级津贴 + 考核阈值
 *   - social_insurance: 社保公积金
 *   - purchase_commission: 采购提成
 *   - general: 通用参数
 * ============================================================
 */

const SalaryRule = require('../models/SalaryRule');

/**
 * 默认规则数据
 */
const DEFAULT_RULES = [
  {
    rule_type: 'commission',
    rule_name: '销售提成阶梯（超额累进）',
    rule_data: {
      mode: 'progressive', // progressive=超额累进, flat=全额通提
      tiers: [
        { min: 0, max: 15000, rate: 0.10, label: '≤1.5万' },
        { min: 15000, max: 30000, rate: 0.15, label: '1.5-3万' },
        { min: 30000, max: 50000, rate: 0.18, label: '3-5万' },
        { min: 50000, max: null, rate: 0.22, label: '>5万' }
      ]
    },
    remark: '超额累进：每档只对超出部分按该档费率计算'
  },
  {
    rule_type: 'grade',
    rule_name: '职级津贴与考核标准',
    rule_data: {
      grades: [
        { grade: 'A', label: '初级', quarterly_min: 0, quarterly_max: 60000, allowance: 0 },
        { grade: 'B', label: '中级', quarterly_min: 60000, quarterly_max: 90000, allowance: 200 },
        { grade: 'C', label: '高级', quarterly_min: 90000, quarterly_max: 120000, allowance: 500 },
        { grade: 'D', label: '资深', quarterly_min: 120000, quarterly_max: 150000, allowance: 900 },
        { grade: 'E', label: '专家', quarterly_min: 150000, quarterly_max: null, allowance: 1400 }
      ],
      evaluation_months: [3, 6, 9, 12], // 考核月份
      effective_delay: 1 // 变更后下个月生效
    },
    remark: '季度考核：每年3/6/9/12月考核上一季度数据，达到目标即享受该档津贴'
  },
  {
    rule_type: 'social_insurance',
    rule_name: '社保公积金参数',
    rule_data: {
      base: 2120, // 西安最低工资基数
      items: [
        { name: '养老保险', rate: 0.08 },
        { name: '医疗保险', rate: 0.02 },
        { name: '失业保险', rate: 0.003 },
        { name: '住房公积金', rate: 0.05 }
      ],
      total_rate: 0.153 // 合计个人缴纳比例
    },
    remark: '按西安最低工资基数计算个人缴纳部分'
  },
  {
    rule_type: 'purchase_commission',
    rule_name: '采购提成阶梯',
    rule_data: {
      tiers: [
        { days_min: 0, days_max: 90, invention: 200, utility: 50, label: '0-3个月' },
        { days_min: 91, days_max: 180, invention: 100, utility: 25, label: '3-6个月' },
        { days_min: 181, days_max: 365, invention: 50, utility: 12.5, label: '6-12个月' },
        { days_min: 366, days_max: 730, invention: 25, utility: 6.25, label: '12-24个月' },
        { days_min: 731, days_max: null, invention: 0, utility: 0, label: '>24个月' }
      ]
    },
    remark: '采购专利卖出提成，按卖出时间距采购时间计算，发明/实用新型分别定价'
  },
  {
    rule_type: 'general',
    rule_name: '通用薪资参数',
    rule_data: {
      work_days_per_month: 21.75, // 法定月计薪天数
      attendance_bonus: 100, // 全勤奖金额
      attendance_rule: '有请假即取消全勤', // 全勤规则说明
      probation_total: 2000, // 实习生月薪合计
      regular_base: 3500 // 正式员工基础合计（不含职级津贴）
    },
    remark: '日薪 = (基本工资+岗位补贴) ÷ 21.75'
  }
];

class SalaryRuleService {

  /**
   * 初始化默认规则（如果表为空则插入默认数据）
   */
  async initDefaultRules() {
    const count = await SalaryRule.count();
    if (count === 0) {
      await SalaryRule.bulkCreate(DEFAULT_RULES);
      return { initialized: true, count: DEFAULT_RULES.length };
    }
    return { initialized: false, count };
  }

  /**
   * 获取所有规则
   */
  async getAllRules() {
    return SalaryRule.findAll({ order: [['id', 'ASC']] });
  }

  /**
   * 获取指定类型的规则
   * @param {string} ruleType
   */
  async getRule(ruleType) {
    return SalaryRule.findOne({ where: { rule_type: ruleType } });
  }

  /**
   * 更新规则
   * @param {string} ruleType
   * @param {Object} data - { rule_data, remark }
   */
  async updateRule(ruleType, data) {
    const rule = await SalaryRule.findOne({ where: { rule_type: ruleType } });
    if (!rule) {
      throw new Error(`规则类型 ${ruleType} 不存在`);
    }
    await rule.update({
      rule_data: data.rule_data,
      ...(data.remark !== undefined && { remark: data.remark })
    });
    return rule;
  }

  /**
   * 重置规则为默认值
   * @param {string} ruleType
   */
  async resetRule(ruleType) {
    const defaultRule = DEFAULT_RULES.find(r => r.rule_type === ruleType);
    if (!defaultRule) {
      throw new Error(`规则类型 ${ruleType} 无默认值`);
    }
    const rule = await SalaryRule.findOne({ where: { rule_type: ruleType } });
    if (!rule) {
      throw new Error(`规则类型 ${ruleType} 不存在`);
    }
    await rule.update({ rule_data: defaultRule.rule_data, remark: defaultRule.remark });
    return rule;
  }

  /**
   * 获取提成计算规则（供 performanceService 调用）
   * @returns {Object} commission rule_data
   */
  async getCommissionRule() {
    const rule = await this.getRule('commission');
    return rule ? rule.rule_data : DEFAULT_RULES[0].rule_data;
  }

  /**
   * 获取职级规则（供 performanceService 调用）
   * @returns {Object} grade rule_data
   */
  async getGradeRule() {
    const rule = await this.getRule('grade');
    return rule ? rule.rule_data : DEFAULT_RULES[1].rule_data;
  }

  /**
   * 获取社保规则
   * @returns {Object} social_insurance rule_data
   */
  async getSocialInsuranceRule() {
    const rule = await this.getRule('social_insurance');
    return rule ? rule.rule_data : DEFAULT_RULES[2].rule_data;
  }
}

module.exports = new SalaryRuleService();
