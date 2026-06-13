 /**
 * 一次性迁移脚本：创建 system_settings 表 + 默认配置
 */
require('dotenv').config();
const { sequelize } = require('../src/config/database');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    await sequelize.query(`CREATE TABLE IF NOT EXISTS system_settings (
      id INT NOT NULL AUTO_INCREMENT,
      setting_key VARCHAR(100) NOT NULL,
      setting_value JSON NOT NULL,
      description VARCHAR(500) DEFAULT NULL,
      category VARCHAR(50) DEFAULT 'general',
      updated_by INT DEFAULT NULL,
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_setting_key (setting_key),
      KEY idx_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统设置'`);
    console.log('✓ 创建 system_settings 表');

    // 插入默认配置
    await sequelize.query(`INSERT INTO system_settings (setting_key, setting_value, description, category)
      VALUES ('channel_sales_cost', '{"发明": 1000, "实用新型": 200, "外观": 200, "default": 500}',
              '渠道销售成本（按专利类型）', 'inventory')
      ON DUPLICATE KEY UPDATE setting_key = setting_key`);
    console.log('✓ 默认配置：channel_sales_cost');

    console.log('\n迁移完成');
  } catch (e) {
    console.error('迁移失败:', e.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

run();
