/**
 * 同步所有模型表结构到数据库
 * 用法: node scripts/sync-tables.js
 */
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Employee = require('../src/models/Employee');
const SalaryRule = require('../src/models/SalaryRule');
const Payroll = require('../src/models/Payroll');
const PerformanceImport = require('../src/models/PerformanceImport');
const PerformanceRecord = require('../src/models/PerformanceRecord');
const PatentInventory = require('../src/models/PatentInventory');

async function run() {
  await connectDatabase();
  await Employee.sync({ force: false });
  console.log('✅ employees table synced');
  await SalaryRule.sync({ force: false });
  console.log('✅ salary_rules table synced');
  await Payroll.sync({ force: false });
  console.log('✅ payrolls table synced');
  await PerformanceImport.sync({ force: false });
  console.log('✅ performance_imports table synced');
  await PerformanceRecord.sync({ force: false });
  console.log('✅ performance_records table synced');
  // alter:true 仅用于补充 patent_inventory 的 purchaser_id 等新增列
  await PatentInventory.sync({ alter: true });
  console.log('✅ patent_inventory table synced (purchaser_id)');
  process.exit(0);
}

run().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
