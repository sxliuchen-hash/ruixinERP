/**
 * 仅供本地开发库初始化/原型同步。生产环境必须使用显式迁移脚本。
 * 用法: NODE_ENV=development node scripts/sync-tables.js
 */
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Employee = require('../src/models/Employee');
const SalaryRule = require('../src/models/SalaryRule');
const Payroll = require('../src/models/Payroll');
const PerformanceImport = require('../src/models/PerformanceImport');
const PerformanceRecord = require('../src/models/PerformanceRecord');
const PatentInventory = require('../src/models/PatentInventory');

function assertDevelopmentOnly(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    const error = new Error('生产环境禁止 Sequelize sync/alter，请执行显式迁移脚本');
    error.code = 'SEQUELIZE_SCHEMA_SYNC_PRODUCTION_FORBIDDEN';
    throw error;
  }
}

async function run() {
  assertDevelopmentOnly();
  await connectDatabase();
  await Employee.sync({ force: false });
  console.log('✅ employees table synced');
  await SalaryRule.sync({ force: false });
  console.log('✅ salary_rules table synced');
  // alter:true 给已存在的 payrolls 表补充新列
  // (income_tax/purchase_commission/事假病假天数/is_adjustment/voided 状态等)
  await Payroll.sync({ alter: true });
  console.log('✅ payrolls table synced (new columns)');
  await PerformanceImport.sync({ force: false });
  console.log('✅ performance_imports table synced');
  await PerformanceRecord.sync({ force: false });
  console.log('✅ performance_records table synced');
  // alter:true 仅用于补充 patent_inventory 的 purchaser_id 等新增列
  await PatentInventory.sync({ alter: true });
  console.log('✅ patent_inventory table synced (purchaser_id)');
  process.exit(0);
}

if (require.main === module) {
  run().catch(e => {
    console.error(`❌ ${e.code || 'SCHEMA_SYNC_FAILED'}:`, e.message);
    process.exit(1);
  });
}

module.exports = { assertDevelopmentOnly, run };
