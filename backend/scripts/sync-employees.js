/**
 * 同步 employees 表结构到数据库
 */
const { connectDatabase } = require('../src/config/database');
const Employee = require('../src/models/Employee');

async function run() {
  await connectDatabase();
  await Employee.sync({ force: false });
  console.log('✅ employees table synced successfully');
  process.exit(0);
}

run().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
