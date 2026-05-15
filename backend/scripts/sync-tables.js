/**
 * 同步所有模型表结构到数据库
 * 用法: node scripts/sync-tables.js
 */
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Employee = require('../src/models/Employee');
const SalaryRule = require('../src/models/SalaryRule');
const Payroll = require('../src/models/Payroll');

async function run() {
  await connectDatabase();
  await Employee.sync({ force: false });
  console.log('✅ employees table synced');
  await SalaryRule.sync({ force: false });
  console.log('✅ salary_rules table synced');
  await Payroll.sync({ force: false });
  console.log('✅ payrolls table synced');
  process.exit(0);
}

run().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
