const contractService = require('../src/services/contractService');

describe('contractService._calculateProgress 合同执行进度', () => {
  test('正常比例', () => {
    expect(contractService._calculateProgress(1000, 500)).toBe(50);
  });

  test('未收款为 0', () => {
    expect(contractService._calculateProgress(1000, 0)).toBe(0);
  });

  test('超额封顶 100', () => {
    expect(contractService._calculateProgress(1000, 2000)).toBe(100);
  });

  test('合同金额为 0 返回 0', () => {
    expect(contractService._calculateProgress(0, 100)).toBe(0);
  });
});
