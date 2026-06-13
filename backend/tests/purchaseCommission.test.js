const svc = require('../src/services/purchaseCommissionService');

describe('purchaseCommissionService._holdingDays 持有天数', () => {
  test('卖出日减采购日', () => {
    expect(svc._holdingDays({ purchase_date: '2024-01-01', sold_time: '2024-01-31' })).toBe(30);
  });

  test('回退到入/出库日期', () => {
    expect(svc._holdingDays({ stock_in_date: '2024-01-01', stock_out_date: '2024-01-11' })).toBe(10);
  });

  test('缺少日期返回 0', () => {
    expect(svc._holdingDays({})).toBe(0);
  });
});

describe('purchaseCommissionService._matchTierAmount 档位匹配', () => {
  const tiers = [
    { days_min: 0, days_max: 90, invention: 5000, utility: 2000 },
    { days_min: 91, days_max: null, invention: 3000, utility: 1000 }
  ];

  test('发明专利取 invention 档价', () => {
    expect(svc._matchTierAmount(tiers, 30, '发明专利')).toBe(5000);
  });

  test('实用新型取 utility 档价', () => {
    expect(svc._matchTierAmount(tiers, 100, '实用新型')).toBe(1000);
  });

  test('无匹配档位返回 0', () => {
    expect(svc._matchTierAmount([], 30, '发明')).toBe(0);
  });
});
