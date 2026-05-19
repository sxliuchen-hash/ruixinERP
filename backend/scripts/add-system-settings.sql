-- ============================================================
-- 系统设置表（key-value 模式，存储业务参数）
-- ============================================================
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(100) NOT NULL COMMENT '设置项键名',
  `setting_value` JSON NOT NULL COMMENT '设置项值（JSON）',
  `description` VARCHAR(500) DEFAULT NULL COMMENT '描述',
  `category` VARCHAR(50) DEFAULT 'general' COMMENT '分类',
  `updated_by` INT DEFAULT NULL COMMENT '最后修改人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_setting_key` (`setting_key`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统设置';

-- 插入默认配置：渠道销售成本（按专利类型）
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`, `category`)
VALUES (
  'channel_sales_cost',
  '{"发明": 1000, "实用新型": 200, "外观": 200, "default": 500}',
  '渠道销售成本（按专利类型）',
  'inventory'
)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
