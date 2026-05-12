import dayjs from 'dayjs'

/**
 * 金额格式化（千分位，2位小数）
 * @param {number|string} amount - 金额
 * @returns {string} 格式化后的金额字符串
 */
export function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '0.00'
  const num = Number(amount)
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * 日期格式化
 * @param {string|Date} date - 日期
 * @param {string} format - 格式模板，默认 'YYYY-MM-DD'
 * @returns {string} 格式化后的日期字符串
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return ''
  return dayjs(date).format(format)
}

/**
 * 百分比格式化
 * @param {number|string} value - 数值（0-1 之间或 0-100）
 * @param {number} digits - 小数位数，默认 2
 * @returns {string} 格式化后的百分比字符串
 */
export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '0.00%'
  const num = Number(value)
  if (isNaN(num)) return '0.00%'
  // 如果值在 0-1 之间，认为是小数形式
  const percent = Math.abs(num) <= 1 ? num * 100 : num
  return percent.toFixed(digits) + '%'
}
