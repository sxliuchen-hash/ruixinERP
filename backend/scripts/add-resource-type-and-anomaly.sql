-- ============================================================
-- 专利库存：增加资源分类、代理商、利润规则字段
-- 新增专利异常告警表
-- ============================================================

-- 1. 为 patent_inventory 增加字段
ALTER TABLE `patent_inventory`
ADD COLUMN `resource_type` ENUM('own','exclusive_agent','joint_agent') DEFAULT 'own' COMMENT '资源类型：自有/独家代理/共同代理' AFTER `patent_type`,
ADD COLUMN `agent_id` INT DEFAULT NULL COMMENT '代理商ID（关联 suppliers.id，独家/共同代理时使用）' AFTER `resource_type`,
ADD COLUMN `profit_rule` JSON DEFAULT NULL COMMENT '利润分成规则（JSON）',
ADD KEY `idx_resource_type` (`resource_type`),
ADD KEY `idx_agent_id` (`agent_id`);

-- 2. 创建专利异常告警表
CREATE TABLE IF NOT EXISTS `patent_anomaly_alerts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `inventory_id` INT NOT NULL COMMENT '关联 patent_inventory.id',
  `patent_no` VARCHAR(50) NOT NULL COMMENT '专利号（冗余便于查询）',
  `anomaly_type` ENUM(
    'pledge',           -- 新增质押
    'license',          -- 新增许可
    'change',           -- 新增变更
    'transfer_fee',     -- 著录项目变更费（疑似转让）
    'legal_status',     -- 法律状态异常
    'other'
  ) NOT NULL COMMENT '异常类型',
  `severity` ENUM('info','warning','danger') DEFAULT 'warning' COMMENT '严重程度',
  `title` VARCHAR(200) NOT NULL COMMENT '告警标题',
  `content` TEXT COMMENT '告警详情（JSON 字符串或纯文本）',
  `event_date` DATE DEFAULT NULL COMMENT '事件发生日期（IP 系统返回的）',
  `detected_at` DATETIME NOT NULL COMMENT '检测时间',
  `is_resolved` TINYINT(1) DEFAULT 0 COMMENT '是否已处理',
  `resolved_by` INT DEFAULT NULL COMMENT '处理人',
  `resolved_at` DATETIME DEFAULT NULL COMMENT '处理时间',
  `resolution_note` TEXT COMMENT '处理备注',
  `dedupe_key` VARCHAR(150) DEFAULT NULL COMMENT '去重键（避免同事件重复告警）',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_id` (`inventory_id`),
  KEY `idx_patent_no` (`patent_no`),
  KEY `idx_anomaly_type` (`anomaly_type`),
  KEY `idx_severity` (`severity`),
  KEY `idx_is_resolved` (`is_resolved`),
  KEY `idx_detected_at` (`detected_at`),
  UNIQUE KEY `uk_dedupe` (`inventory_id`, `dedupe_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专利异常告警表';
