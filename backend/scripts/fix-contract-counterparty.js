/**
 * 修复脚本：为已同步的合同补充客户/供应商关联
 * 从合同标题中提取对方单位名称，匹配或创建客户/供应商
 */
require('dotenv').config();
const { Contract, Customer, Supplier } = require('../src/models');

async function main() {
  // 找出所有企微同步的合同（sp_no 以 2026 开头）且没有客户/供应商的
  const contracts = await Contract.findAll({
    where: {
      sp_no: { [require('sequelize').Op.ne]: null },
      customer_id: null,
      supplier_id: null
    }
  });

  console.log(`找到 ${contracts.length} 条需要修复的合同`);

  let fixed = 0;
  for (const c of contracts) {
    // 从标题提取对方名称（格式："对方名称 - 合同类型"）
    const match = c.title?.match(/^(.+?)\s*[-—]/);
    const name = match ? match[1].trim() : null;
    if (!name || name === '企微审批') continue;

    if (c.type === 'sale') {
      let customer = await Customer.findOne({ where: { name } });
      if (!customer) customer = await Customer.create({ name });
      await c.update({ customer_id: customer.id });
    } else {
      let supplier = await Supplier.findOne({ where: { name } });
      if (!supplier) supplier = await Supplier.create({ name });
      await c.update({ supplier_id: supplier.id });
    }
    fixed++;
  }

  console.log(`修复完成: ${fixed} 条`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
