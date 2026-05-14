/**
 * ============================================================
 * 薪资规则服务（SalaryRuleService）
 * ============================================================
 *
 * 管理薪资计算规则的 CRUD 和初始化。
 * 规则以 key-value 形式存储，value 为 JSON。
 *
 * 【默认规则】
 * 系统初始化时写入默认规则，admin 可在前端修改。
 * performanceService 和 payrollService 读取规则时从此服务获取。
 * ============================================================
 */

const SalaryRule = require('../models/SalaryRule');

/**
 * 默认规则数据（首次初始化用）
 */
const DEFAULT_RULES = [
  // ===== 销售提成（超额累进）=====
  {
    category: 'commission',
    rule_key: 'sales_commission_tiers',
    rule_name: '销售提成阶梯',
    rule_value: JSON.stringify([
      { min: 0, max: 15000, rate: 0.10, label: '≤1.5万' },
      { min: 15000, max: 30000, rate: 0.15, label: '1.5-3万' },
      { min: 30000, max: 50000, rate: 0.18, label: '3-5万' },
      { min: 50000, max: null, rate: 0.22, label: '>5万' }
    ]),
    description: '销售月度提成，超额累进计算。每档按超出部分×对应费率累加。'
  },

  // ===== 职级津贴 =====
  {
    category: 'grade',
    rule_key: 'grade_allowance',
    rule_name: '职级津贴',
    rule_value: JSON.stringify([
      { grade: 'A', label: '初级', quarterly_min: 0, quarterly_max: 60000, allowance: 0 },
      { grade: 'B', label: '中级', quarterly_min: 60000, quarterly_max: 90000, allowance: 200 },
      { grade: 'C', label: '高级', quarterly_min: 90000, quarterly_max: 120000, allowance: 500 },
      { grade: 'D', label: '资深', quarterly_min: 120000, quarterly_max: 150000, allowance: 900 },
      { grade: 'E', label: '专家', quarterly_min: 150000, quarterly_max: null, allowance: 1400 }
    ]),
    description: '按季度累计毛利判定职级，达到目标即享受对应津贴。考核期：每年3/6/9/12月。'
  },

  // ===== 社保公积金 =====
  {
    category: 'social_insurance',
    rule_key: 'social_insurance_base',
    rule_name: '社保缴纳基数',
    rule_value: JSON.stringify({ base: 2120, city: '西安' }),
    description: '按西安最低工资标准作为社保缴纳基数'
  },
  {
    category: 'social_insurance',
    rule_key: 'social_insurance_rates',
    rule_name: '社保缴纳比例',
    rule_value: JSON.stringify({
      pension: { personal: 0.08, company: 0.16, label: '养老保险' },
      medical: { personal: 0.02, company: 0.08, label: '医疗保险' },
      unemployment: { personal: 0.003, company: 0.007, label: '失业保险' },
      housing_fund: { personal: 0.05, company: 0.05, label: '住房公积金' },
      injury: { personal: 0, company: 0.002, label: '工伤保险' },
      maternity: { personal: 0, company: 0, label: '生育保险（已并入医疗）' }
    }),
    description: '个人+公司缴纳比例。个人合计约15.3%。'
  },

  // ===== 采购提成 =====
  {
    category: 'purchase_commission',
    rule_key: 'purchase_commission_tiers',
    rule_name: '采购提成阶梯',
    rule_value: JSON.stringify({
      invention: [
        { days_min: 0, days_max: 90, amount: 200, label: '0-3个月' },
        { days_min: 91, days_max: 180, amount: 100, label: '3-6个月' },
        { days_min: 181, days_max: 365, amount: 50, label: '6-12个月' },
        { days_min: 366, days_max: 730, amount: 25, label: '12-24个月' },
        { days_min: 731, days_max: null, amount: 0, label: '>24个月' }
      ],
      utility: [
        { days_min: 0, days_max: 90, amount: 50, label: '0-3个月' },
        { days_min: 91, days_max: 180, amount: 25, label: '3-6个月' },
        { days_min: 181, days_max: 365, amount: 12.5, label: '6-12个月' },
        { days_min: 366, days_max: 730, amount: 6.25, label: '12-24个月' },
        { days_min: 731, days_max: null, amount: 0, label: '>24个月' }
      ]
    }),
    description: '采购专利卖出提成，按卖出时间距采购时间计算。发明/实用新型分别定价。'
  },

  // ===== 通用参数 =====
  {
    category: 'general',
    rule_key: 'base_salary_default',
    rule_name: '默认基本工资',
    rule_value: JSON.stringify({ amount: 2400 }),
    description: '正式员工默认基本工资'
  },
  {
    category: 'general',
    rule_key: 'position_allowance_default',
    rule_name: '默认岗位补贴',
    rule_value: JSON.stringify({ amount: 1000 }),
    description: '正式员工默认岗位补贴'
  },
  {
    category: 'general',
    rule_key: 'attendance_bonus',
    rule_name: '全勤奖',
    rule_value: JSON.stringify({ amount: 100, rule: '当月有请假则为0' }),
    description: '全勤奖金额，有请假即取消'
  },
  {
    category: 'general',
    rule_key: 'daily_wage_divisor',
    rule_name: '日薪计算基数',
    rule_value: JSON.stringify({ divisor: 21.75 }),
    description: '日薪 = (基本工资+岗位补贴) ÷ 21.75'
  },
  {
    category: 'general',
    rule_key: 'partner_share_rate',
    rule_name: '合伙人分成比例',
    rule_value: JSON.stringify({ partner_rate: 0.7, boss_rate: 0.3 }),
    description: '合伙人（罗正武）业务毛利×70%归本人，30%归老板（刘晨）'
  },
  {
    category: 'general',
    rule_key: 'probation_salary',
    rule_name: '试用期薪资',
    rule_value: JSON.stringify({ total: 2000, note: '实习生（未签三方）基础合计2000元/月' }),
    description: '试用期/实习生基础薪资合计'
  }
];

class SalaryRuleService {

  /**
   * 初始化默认规则（仅在表为空时执行）
   */
  async initDefaultRules() {
    const count = await SalaryRule.count();
    if (count > 0) return { initialized: false, message: '规则已存在，跳过初始化' };

    await SalaryRule.bulkCreate(DEFAULT_RULES);
    return { initialized: true, message: `已初始化 ${DEFAULT_RULES.length} 条默认规则` };
  }

  /**
   * 获取所有规则（按分类分组）
   */
  async getAllRules() {
    const rules = await SalaryRule.findAll({
      order: [['category', 'ASC'], ['id', 'ASC']]
    });

    // 按 category 分组
    const grouped = {};
    rules.forEach(r => {
      const rule = r.toJSON();
      rule.rule_value = JSON.parse(rule.rule_value);
      if (!grouped[rule.category]) grouped[rule.category] = [];
      grouped[rule.category].push(rule);
    });

    return grouped;
  }

  /**
   * 获取单条规则（按 key）
   */
  async getRuleByKey(key) {
    const rule = await SalaryRule.findOne({ where: { rule_key: key } });
    if (!rule) return null;
    const result = rule.toJSON();
    result.rule_value = JSON.parse(result.rule_value);
    return result;
  }

  /**
   * 更新规则值
   */
  async updateRule(id, data) {
    const rule = await SalaryRule.findByPk(id);
    if (!rule) throw new Error('规则不存在');
    if (!rule.editable) throw new Error('该规则不允许编辑');

    const updateData = {};
    if (data.rule_value !== undefined) {
      updateData.rule_value = typeof data.rule_value === 'string'
        ? data.rule_value
        : JSON.stringify(data.rule_value);
    }
    if (data.rule_name) updateData.rule_name = data.rule_name;
    if (data.description !== undefined) updateData.description = data.description;

    await rule.update(updateData);
    const result = rule.toJSON();
    result.rule_value = JSON.parse(result.rule_value);
    return result;
  }

  /**
   * 获取提成计算所需的规则（供 performanceService 调用）
   */
  async getCommissionTiers() {
    const rule = await this.getRuleByKey('sales_commission_tiers');
    return rule ? rule.rule_value : DEFAULT_RULES[0].rule_value;
  }

  /**
   * 获取职级津贴配置
   */
  async getGradeAllowance() {
    const rule = await this.getRuleByKey('grade_allowance');
    return rule ? rule.rule_value : JSON.parse(DEFAULT_RULES[1].rule_value);
  }

  /**
   * 获取社保参数
   */
  async getSocialInsuranceParams() {
    const base = await this.getRuleByKey('social_insurance_base');
    const rates = await this.getRuleByKey('social_insurance_rates');
    return {
      base: base ? base.rule_value : { base: 2120, city: '西安' },
      rates: rates ? rates.rule_value : JSON.parse(DEFAULT_RULES[3].rule_value)
    };
  }
}

module.exports = new SalaryRuleService();
