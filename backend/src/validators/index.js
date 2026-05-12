/**
 * 参数校验 Schema 注册中心
 *
 * 使用 Joi 定义各业务模块的校验规则，配合 middlewares/validate.js 中间件使用：
 *   router.post('/path', validate(schema), controller)
 *
 * 命名约定：
 *   - createXxxSchema   ：创建时的必填校验
 *   - updateXxxSchema   ：更新时的非必填校验（至少 1 个字段）
 *   - updateXxxStatusSchema / listQuerySchema ：专项校验
 */

const customerSchemas = require('./customer');
const supplierSchemas = require('./supplier');
const invoiceSchemas = require('./invoice');
const contractSchemas = require('./contract');
const paymentSchemas = require('./payment');
const expenseSchemas = require('./expense');
const loanSchemas = require('./loan');
const inventorySchemas = require('./inventory');
const projectSchemas = require('./project');
const costSchemas = require('./cost');
const notificationSchemas = require('./notification');

module.exports = {
  ...customerSchemas,
  ...supplierSchemas,
  ...invoiceSchemas,
  ...contractSchemas,
  ...paymentSchemas,
  ...expenseSchemas,
  ...loanSchemas,
  ...inventorySchemas,
  ...projectSchemas,
  ...costSchemas,
  ...notificationSchemas,
};
