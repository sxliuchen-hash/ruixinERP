const { parsePagination, MAX_LIMIT } = require('../src/utils/pagination');

describe('parsePagination 分页参数解析', () => {
  test('默认值', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  test('正常分页 offset 计算', () => {
    expect(parsePagination({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  test('limit 超上限被截断', () => {
    expect(parsePagination({ limit: 9999 }).limit).toBe(MAX_LIMIT);
  });

  test('非法 page 回落为 1', () => {
    expect(parsePagination({ page: 0 }).page).toBe(1);
    expect(parsePagination({ page: -5 }).page).toBe(1);
  });

  test('兼容 pageSize 字段', () => {
    expect(parsePagination({ pageSize: 50 }).limit).toBe(50);
  });
});
