const payrollService = require('../src/services/payrollService');

describe('payrollService.calcSalesCommission 超额累进销售提成', () => {
  const rule = {
    tiers: [
      { min: 0, max: 10000, rate: 0.05 },
      { min: 10000, max: null, rate: 0.1 }
    ]
  };

  test('低于第一档上限按第一档计提', () => {
    expect(payrollService.calcSalesCommission(5000, rule)).toBe(250);
  });

  test('跨档按超额累进累加', () => {
    // 10000*0.05 + 10000*0.1 = 1500
    expect(payrollService.calcSalesCommission(20000, rule)).toBe(1500);
  });

  test('业绩为 0 或负数返回 0', () => {
    expect(payrollService.calcSalesCommission(0, rule)).toBe(0);
    expect(payrollService.calcSalesCommission(-100, rule)).toBe(0);
  });

  test('无规则/空档位返回 0', () => {
    expect(payrollService.calcSalesCommission(20000, {})).toBe(0);
    expect(payrollService.calcSalesCommission(20000, { tiers: [] })).toBe(0);
  });
});

describe('payrollService.calcIncomeTax 简化个税', () => {
  const rule = {
    threshold: 5000,
    special_deduction: 0,
    brackets: [
      { min: 0, max: 3000, rate: 0.03, deduct: 0 },
      { min: 3000, max: 12000, rate: 0.1, deduct: 210 },
      { min: 12000, max: null, rate: 0.2, deduct: 1410 }
    ]
  };

  test('应纳税所得额为 0 时不计税', () => {
    expect(payrollService.calcIncomeTax(5000, rule)).toBe(0);
  });

  test('第一档税率', () => {
    // (8000-5000)*0.03 = 90
    expect(payrollService.calcIncomeTax(8000, rule)).toBe(90);
  });

  test('高档应用速算扣除数', () => {
    // (20000-5000)*0.2 - 1410 = 1590
    expect(payrollService.calcIncomeTax(20000, rule)).toBe(1590);
  });

  test('无规则返回 0', () => {
    expect(payrollService.calcIncomeTax(20000, null)).toBe(0);
  });
});

describe('payrollService._calcLeave 请假扣款', () => {
  const attendanceRule = { personal_leave_deduct_rate: 1, sick_pay_rate: 0.6 };

  test('事假按日薪全额扣（日薪=(基本+岗位)/21.75）', () => {
    const r = payrollService._calcLeave(1, 0, 2400, 1000, 21.75, attendanceRule);
    expect(r.personal).toBeCloseTo(156.32, 1);
    expect(r.sick).toBe(0);
  });

  test('病假按 (1-发放系数) 扣', () => {
    const r = payrollService._calcLeave(0, 1, 2400, 1000, 21.75, attendanceRule);
    expect(r.sick).toBeCloseTo(62.53, 1);
  });

  test('无请假为 0', () => {
    const r = payrollService._calcLeave(0, 0, 2400, 1000, 21.75, attendanceRule);
    expect(r.total).toBe(0);
  });
});
