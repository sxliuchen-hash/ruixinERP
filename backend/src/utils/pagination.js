/**
 * 分页工具函数
 * 解析请求中的 page/limit 参数，返回 Sequelize 所需的 offset/limit
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 解析分页参数
 * @param {object} query - 请求查询参数 { page, limit/pageSize }
 * @returns {{ page: number, limit: number, offset: number }}
 */
const parsePagination = (query = {}) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit || query.pageSize, 10);

  // 校验并设置默认值
  if (isNaN(page) || page < 1) {
    page = DEFAULT_PAGE;
  }
  if (isNaN(limit) || limit < 1) {
    limit = DEFAULT_LIMIT;
  }
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }

  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

/**
 * 构建分页响应
 * @param {object} data - Sequelize findAndCountAll 返回的 { count, rows }
 * @param {number} page - 当前页码
 * @param {number} limit - 每页条数
 * @returns {object} 分页响应对象
 */
const buildPaginationResponse = (data, page, limit) => {
  const { count, rows } = data;
  const totalPages = Math.ceil(count / limit);

  return {
    list: rows,
    pagination: {
      page,
      limit,
      total: count,
      totalPages
    }
  };
};

module.exports = {
  parsePagination,
  buildPaginationResponse,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
