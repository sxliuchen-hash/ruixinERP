/**
 * 临时脚本：同步所有模型到数据库（创建表结构）
 * 用法：node scripts/sync-tables.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  // 加载所有模型（会触发关联关系定义）
  const { sequelize } = require('../src/models');

  console.log('开始同步表结构...');
  await sequelize.sync({ force: false, alter: false });
  console.log('表结构同步完成！');

  await sequelize.close();
  process.exit(0);
}

main().catch(e => {
  console.error('同步失败:', e.message);
  process.exit(1);
});
