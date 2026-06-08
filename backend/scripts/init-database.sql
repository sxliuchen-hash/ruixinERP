-- ============================================================
-- ERP 财务系统数据库初始化脚本
-- 创建时间: 2025
-- 说明: Phase 1 基础表结构，包含预置数据
-- 任务: Task 1.3 - 创建 erp_db 数据库 + 基础表
--   - system_configs 系统配置表
--   - operation_logs 操作日志表
--   - cost_categories 成本分类表（含预置数据）
--   - classify_rules 自动归类规则表（含预置关键词）
--   - bank_accounts 银行账户表
--   - account_transfers 账户间转账表
-- ============================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS erp_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE erp_db;

-- ============================================================
-- 1. system_configs 系统配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS `system_configs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(100) NOT NULL COMMENT '配置键',
  `config_value` TEXT COMMENT '配置值',
  `category` VARCHAR(50) DEFAULT NULL COMMENT '分类',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '说明',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 预置系统配置
INSERT INTO `system_configs` (`config_key`, `config_value`, `category`, `description`) VALUES
('wechat_corp_id', '', 'wechat', '企业微信 CorpID'),
('wechat_approval_secret', '', 'wechat', '审批应用 Secret'),
('wechat_callback_token', '', 'wechat', '回调 Token'),
('wechat_callback_aes_key', '', 'wechat', '回调 EncodingAESKey'),
('wechat_agent_id', '', 'wechat', '应用 AgentId'),
('fee_reminder_days', '60,30,7', 'reminder', '年费到期提醒天数（逗号分隔）'),
('contract_reminder_days', '30', 'reminder', '合同到期提醒天数'),
('wechat_sync_interval', '3600', 'wechat', '企业微信审批同步间隔（秒）'),
('system_version', '1.0.0', 'system', '系统版本号');

-- ============================================================
-- 2. operation_logs 操作日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS `operation_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT '操作人',
  `action` VARCHAR(50) NOT NULL COMMENT '操作类型（create/update/delete）',
  `target_table` VARCHAR(50) DEFAULT NULL COMMENT '目标表',
  `target_id` INT DEFAULT NULL COMMENT '目标记录ID',
  `before_data` JSON DEFAULT NULL COMMENT '变更前数据',
  `after_data` JSON DEFAULT NULL COMMENT '变更后数据',
  `ip_address` VARCHAR(50) DEFAULT NULL COMMENT 'IP地址',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_target_table` (`target_table`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

-- ============================================================
-- 3. cost_categories 成本分类表
-- ============================================================
CREATE TABLE IF NOT EXISTS `cost_categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL COMMENT '类别名称',
  `parent_id` INT DEFAULT NULL COMMENT '父类别（支持二级分类）',
  `type` ENUM('labor','operation','patent','marketing','other') NOT NULL COMMENT '大类',
  `sort_order` INT DEFAULT 0 COMMENT '排序',
  `status` TINYINT DEFAULT 1 COMMENT '1启用/0停用',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成本分类表';

-- 预置数据：一级分类
INSERT INTO `cost_categories` (`id`, `name`, `parent_id`, `type`, `sort_order`) VALUES
(1, '人力成本', NULL, 'labor', 1),
(2, '运营成本', NULL, 'operation', 2),
(3, '专利维持', NULL, 'patent', 3),
(4, '营销成本', NULL, 'marketing', 4);

-- 预置数据：二级分类 - 人力成本
INSERT INTO `cost_categories` (`id`, `name`, `parent_id`, `type`, `sort_order`) VALUES
(11, '工资', 1, 'labor', 1),
(12, '社保', 1, 'labor', 2),
(13, '公积金', 1, 'labor', 3);

-- 预置数据：二级分类 - 运营成本
INSERT INTO `cost_categories` (`id`, `name`, `parent_id`, `type`, `sort_order`) VALUES
(21, '房租', 2, 'operation', 1),
(22, '水电', 2, 'operation', 2),
(23, '网络', 2, 'operation', 3),
(24, '物业', 2, 'operation', 4),
(25, '办公用品', 2, 'operation', 5);

-- 预置数据：二级分类 - 专利维持
INSERT INTO `cost_categories` (`id`, `name`, `parent_id`, `type`, `sort_order`) VALUES
(31, '年费', 3, 'patent', 1),
(32, '代理费', 3, 'patent', 2);

-- 预置数据：二级分类 - 营销成本
INSERT INTO `cost_categories` (`id`, `name`, `parent_id`, `type`, `sort_order`) VALUES
(41, '推广', 4, 'marketing', 1),
(42, '获客', 4, 'marketing', 2);

-- ============================================================
-- 4. classify_rules 自动归类规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS `classify_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `keyword` VARCHAR(100) NOT NULL COMMENT '关键词',
  `category_id` INT NOT NULL COMMENT '匹配的成本类别ID',
  `priority` INT DEFAULT 0 COMMENT '优先级（数值越大优先级越高）',
  `status` TINYINT DEFAULT 1 COMMENT '1启用/0停用',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_keyword` (`keyword`),
  KEY `idx_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自动归类规则表';

-- 预置数据：关键词 → 类别映射
INSERT INTO `classify_rules` (`keyword`, `category_id`, `priority`) VALUES
-- 运营成本
('物业', 24, 10),
('物业费', 24, 10),
('水电', 22, 10),
('电费', 22, 8),
('水费', 22, 8),
('房租', 21, 10),
('租金', 21, 8),
('网络', 23, 10),
('宽带', 23, 10),
('京东', 25, 5),
('淘宝', 25, 5),
('拼多多', 25, 5),
('办公用品', 25, 8),
-- 人力成本
('工资', 11, 10),
('薪资', 11, 10),
('社保', 12, 10),
('公积金', 13, 10),
-- 专利维持
('年费', 31, 10),
('代理费', 32, 10),
-- 营销成本
('推广', 41, 10),
('获客', 42, 10),
('广告', 41, 8);

-- ============================================================
-- 5. bank_accounts 银行账户表
-- ============================================================
CREATE TABLE IF NOT EXISTS `bank_accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL COMMENT '账户名称',
  `bank_name` VARCHAR(100) DEFAULT NULL COMMENT '开户行',
  `account_no` VARCHAR(50) DEFAULT NULL COMMENT '账号',
  `account_type` ENUM('public','private') NOT NULL COMMENT '账户类型：对公/对私',
  `initial_balance` DECIMAL(12,2) DEFAULT 0.00 COMMENT '初始余额',
  `status` TINYINT DEFAULT 1 COMMENT '1启用/0停用',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_no` (`account_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='银行账户表';

-- ============================================================
-- 6. account_transfers 账户间转账表
-- ============================================================
CREATE TABLE IF NOT EXISTS `account_transfers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `from_account_id` INT NOT NULL COMMENT '转出账户',
  `to_account_id` INT NOT NULL COMMENT '转入账户',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '转账金额',
  `transfer_date` DATE NOT NULL COMMENT '转账日期',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_from_account` (`from_account_id`),
  KEY `idx_to_account` (`to_account_id`),
  KEY `idx_transfer_date` (`transfer_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户间转账表';

-- ============================================================
-- 7. payments 收付款表
-- ============================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `type` ENUM('income','expense') NOT NULL COMMENT '收款/付款',
  `category` ENUM('business','fee') NOT NULL DEFAULT 'business' COMMENT '业务类/费用类',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '金额',
  `payment_date` DATE NOT NULL COMMENT '收付款日期',
  `payment_method` ENUM('transfer','check','cash','other') DEFAULT 'transfer' COMMENT '方式',
  `account_id` INT NOT NULL COMMENT '银行账户ID',
  `contract_id` INT DEFAULT NULL COMMENT '关联合同（业务类）',
  `customer_id` INT DEFAULT NULL COMMENT '客户（收款时）',
  `supplier_id` INT DEFAULT NULL COMMENT '供应商（付款时）',
  `project_id` INT DEFAULT NULL COMMENT '关联交易项目',
  `cost_category_id` INT DEFAULT NULL COMMENT '成本类别ID（费用类）',
  `sp_no` VARCHAR(50) DEFAULT NULL COMMENT '关联企业微信审批单号',
  `confirm_status` ENUM('pending','confirmed') DEFAULT 'confirmed' COMMENT '确认状态',
  `summary` VARCHAR(500) DEFAULT NULL COMMENT '摘要',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `idx_sp_no` (`sp_no`),
  KEY `idx_confirm_status` (`confirm_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收付款表';

-- ============================================================
-- 8. cost_records 成本记录表
-- ============================================================
-- 用途：
--   1) 费用类 payments（category='fee'）的财务成本明细（T17 完善自动联动）
--   2) Phase 3 固定月费自动生成（is_recurring=1）
--   3) 人力成本按月/按人录入
CREATE TABLE IF NOT EXISTS `cost_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `category_id` INT NOT NULL COMMENT '成本类别ID',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '金额',
  `cost_month` CHAR(7) DEFAULT NULL COMMENT '所属月份（2026-05）',
  `user_id` INT DEFAULT NULL COMMENT '关联人员（人力成本时）',
  `payment_id` INT DEFAULT NULL COMMENT '关联收付款记录ID（费用类 payment 自动写入时）',
  `account_id` INT DEFAULT NULL COMMENT '付款账户',
  `is_recurring` TINYINT DEFAULT 0 COMMENT '是否固定月费',
  `summary` VARCHAR(500) DEFAULT NULL COMMENT '摘要',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_category_id` (`category_id`),
  KEY `idx_cost_month` (`cost_month`),
  KEY `idx_payment_id` (`payment_id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成本记录表';


-- ============================================================
-- Phase 2 T12: 报销与借款
-- ============================================================

-- ============================================================
-- 9. expenses 报销单表
-- ============================================================
-- 用途：员工日常费用报销（差旅/招待/办公等）
-- 说明：
--   1) 不直接写 payments 表，保持单据独立性（避免双重计账）
--   2) confirm_status='confirmed' 后由 accountService.calculateBalance 纳入账户余额
--   3) cost_category_id 指向 cost_categories（建议选用二级分类）
-- ============================================================
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT '报销人（主项目 users.id）',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '报销金额',
  `cost_category_id` INT DEFAULT NULL COMMENT '报销类别（cost_categories.id）',
  `expense_date` DATE NOT NULL COMMENT '费用发生日期',
  `account_id` INT DEFAULT NULL COMMENT '付款账户',
  `sp_no` VARCHAR(50) DEFAULT NULL COMMENT '关联企微审批单号（幂等键）',
  `confirm_status` ENUM('pending','confirmed') DEFAULT 'confirmed' COMMENT '确认状态',
  `summary` VARCHAR(500) DEFAULT NULL COMMENT '摘要（自动归类匹配字段）',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人（agent 数据隔离依据）',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_cost_category_id` (`cost_category_id`),
  KEY `idx_expense_date` (`expense_date`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_sp_no` (`sp_no`),
  KEY `idx_confirm_status` (`confirm_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报销单表';

-- ============================================================
-- 10. loans 借款单表
-- ============================================================
-- 用途：员工向公司借款（备用金/差旅预支）
-- 说明：
--   1) repaid_amount 为冗余字段，由 loan_repayments 聚合后写入
--   2) status 自动维护：0 → unpaid，< amount → partial，>= amount → paid
--   3) 借款金额计入 account_id 的支出（calculateBalance 聚合）
-- ============================================================
CREATE TABLE IF NOT EXISTS `loans` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT '借款人（主项目 users.id）',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '借款金额',
  `repaid_amount` DECIMAL(12,2) DEFAULT 0.00 COMMENT '已还金额（聚合冗余）',
  `loan_date` DATE NOT NULL COMMENT '借款日期',
  `purpose` VARCHAR(500) DEFAULT NULL COMMENT '借款用途',
  `status` ENUM('unpaid','partial','paid') DEFAULT 'unpaid' COMMENT '还款状态（自动维护）',
  `account_id` INT DEFAULT NULL COMMENT '付款账户',
  `sp_no` VARCHAR(50) DEFAULT NULL COMMENT '关联企微审批单号',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_loan_date` (`loan_date`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_sp_no` (`sp_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='借款单表';

-- ============================================================
-- 11. loan_repayments 借款还款明细表
-- ============================================================
-- 用途：借款的分次还款记录
-- 说明：
--   1) 每笔还款记录写入后，事务内重算父 loan 的 repaid_amount 和 status
--   2) 还款金额计入 account_id 的收入（calculateBalance 聚合）
--   3) 删除借款时需级联删除本表对应的 loan_id 记录（service 层显式处理）
-- ============================================================
CREATE TABLE IF NOT EXISTS `loan_repayments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `loan_id` INT NOT NULL COMMENT '关联借款 ID',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '本次还款金额',
  `repay_date` DATE NOT NULL COMMENT '还款日期',
  `account_id` INT DEFAULT NULL COMMENT '收款账户',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_loan_id` (`loan_id`),
  KEY `idx_repay_date` (`repay_date`),
  KEY `idx_account_id` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='借款还款明细表';


-- ============================================================
-- Phase 3 T14: 专利库存管理
-- ============================================================

-- ============================================================
-- 12. patent_inventory 专利库存表
-- ============================================================
-- 说明：
--   1) patent_no 唯一约束，避免重复录入同一专利
--   2) total_maintain_cost 为聚合冗余，由 patent_annual_fees 汇总后写入
--   3) 库龄 = DATEDIFF(NOW(), stock_in_date)，利润预估由 service 层计算
-- ============================================================
CREATE TABLE IF NOT EXISTS `patent_inventory` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `patent_no` VARCHAR(50) NOT NULL COMMENT '专利号',
  `patent_name` VARCHAR(500) NOT NULL COMMENT '专利名称',
  `patent_type` VARCHAR(20) DEFAULT NULL COMMENT '专利类型（发明/实用新型/外观）',
  `tech_field` VARCHAR(100) DEFAULT NULL COMMENT '技术领域',
  `purchase_price` DECIMAL(12,2) DEFAULT 0.00 COMMENT '采购价格',
  `purchase_date` DATE DEFAULT NULL COMMENT '采购日期',
  `supplier_id` INT DEFAULT NULL COMMENT '供应商ID',
  `contract_id` INT DEFAULT NULL COMMENT '关联采购合同ID',
  `project_id` INT DEFAULT NULL COMMENT '关联交易项目ID（T16）',
  `status` ENUM('in_stock','sold','abandoned','transferring') DEFAULT 'in_stock' COMMENT '库存状态',
  `current_price` DECIMAL(12,2) DEFAULT 0.00 COMMENT '当前售价',
  `total_maintain_cost` DECIMAL(12,2) DEFAULT 0.00 COMMENT '累计维持成本（冗余）',
  `next_fee_deadline` DATE DEFAULT NULL COMMENT '下次年费到期日',
  `stock_in_date` DATE DEFAULT NULL COMMENT '入库日期（库龄起点）',
  `stock_out_date` DATE DEFAULT NULL COMMENT '出库日期',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_patent_no` (`patent_no`),
  KEY `idx_status` (`status`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_next_fee_deadline` (`next_fee_deadline`),
  KEY `idx_tech_field` (`tech_field`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专利库存表';

-- ============================================================
-- 13. patent_annual_fees 专利年费表
-- ============================================================
-- 说明：
--   1) 每条记录新增/删除后，service 层事务内重算父专利的 total_maintain_cost
--      和 next_fee_deadline
--   2) payment_id 可选关联真实付款记录，便于对账
-- ============================================================
CREATE TABLE IF NOT EXISTS `patent_annual_fees` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `inventory_id` INT NOT NULL COMMENT '关联 patent_inventory.id',
  `fee_type` ENUM('annual','agency','other') DEFAULT 'annual' COMMENT '费用类型',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '金额',
  `fee_date` DATE NOT NULL COMMENT '缴费日期',
  `deadline_date` DATE DEFAULT NULL COMMENT '本次缴费能维持到的到期日',
  `payment_id` INT DEFAULT NULL COMMENT '关联 payments.id',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_inventory_id` (`inventory_id`),
  KEY `idx_fee_date` (`fee_date`),
  KEY `idx_deadline_date` (`deadline_date`),
  KEY `idx_payment_id` (`payment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专利年费/维持成本表';

-- ============================================================
-- 14. patent_price_history 专利调价历史表
-- ============================================================
-- 说明：
--   1) 只新增不修改（作为审计流水）
--   2) 每次调价会同时更新 patent_inventory.current_price 并插入一条 history（事务内）
--   3) 批量调价时每个专利生成一条 history
-- ============================================================
CREATE TABLE IF NOT EXISTS `patent_price_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `inventory_id` INT NOT NULL COMMENT '关联 patent_inventory.id',
  `old_price` DECIMAL(12,2) DEFAULT 0.00 COMMENT '调价前价格',
  `new_price` DECIMAL(12,2) NOT NULL COMMENT '调价后价格',
  `change_date` DATE NOT NULL COMMENT '调价日期',
  `reason` VARCHAR(500) DEFAULT NULL COMMENT '调价原因',
  `created_by` INT DEFAULT NULL COMMENT '操作人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_inventory_id` (`inventory_id`),
  KEY `idx_change_date` (`change_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专利调价历史表';


-- ============================================================
-- Phase 3 T16: 交易项目管理
-- ============================================================

-- ============================================================
-- 15. projects 交易项目表
-- ============================================================
-- 说明：
--   1) Project 把"专利囤积→销售"串成一个可核算利润的单元
--   2) 聚合字段（sale_amount/purchase_amount/tax_cost/maintain_cost/gross_profit）
--      由 projectService.refreshAggregates 从关联数据（合同/收付款/年费）聚合写入
--   3) 状态自动流转：所有关联销售合同均 completed → 项目 completed
--   4) 数据隔离：agent 只能看 created_by=自己 OR owner_id=自己 的项目
-- ============================================================
CREATE TABLE IF NOT EXISTS `projects` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(200) NOT NULL COMMENT '项目名称',
  `patent_no` VARCHAR(50) DEFAULT NULL COMMENT '关联专利号（便于索引）',
  `customer_id` INT DEFAULT NULL COMMENT '客户ID',
  `supplier_id` INT DEFAULT NULL COMMENT '供应商ID',
  `status` ENUM('active','completed','cancelled') DEFAULT 'active' COMMENT '项目状态',
  `sale_amount` DECIMAL(12,2) DEFAULT 0.00 COMMENT '销售收入（聚合冗余）',
  `purchase_amount` DECIMAL(12,2) DEFAULT 0.00 COMMENT '采购成本（聚合冗余）',
  `tax_cost` DECIMAL(12,2) DEFAULT 0.00 COMMENT '采购税点成本（聚合冗余）',
  `maintain_cost` DECIMAL(12,2) DEFAULT 0.00 COMMENT '维持成本（聚合冗余）',
  `gross_profit` DECIMAL(12,2) DEFAULT 0.00 COMMENT '毛利润（冗余）',
  `owner_id` INT DEFAULT NULL COMMENT '负责人',
  `remark` TEXT COMMENT '备注',
  `created_by` INT DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_owner_id` (`owner_id`),
  KEY `idx_patent_no` (`patent_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交易项目表';


-- ============================================================
-- Phase 3 T15: 系统消息中心
-- ============================================================

-- ============================================================
-- 16. notifications 系统消息表
-- ============================================================
-- 用途：
--   1) 合同到期提醒（由 contractReminderJob 每日生成）
--   2) 专利年费到期提醒（由 feeReminderJob 每日生成）
--   3) 企微审批同步失败提醒（T10 预留）
--   4) 管理员系统公告（预留）
--
-- 去重策略：
--   同一个 (user_id, source_type, source_id, dedupe_key) 组合每日仅生成一条未读消息，
--   避免 cron 每天运行产生重复提醒。dedupe_key 由 service 层生成（如 '30d_2026-06-10'）。
-- ============================================================
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT DEFAULT NULL COMMENT '接收人（NULL 表示广播给 admin）',
  `type` ENUM('contract_expire','fee_deadline','approval_sync','system','other') NOT NULL COMMENT '消息类型',
  `level` ENUM('info','warning','danger') DEFAULT 'info' COMMENT '严重程度',
  `title` VARCHAR(200) NOT NULL COMMENT '标题',
  `content` TEXT COMMENT '详细内容',
  `link` VARCHAR(500) DEFAULT NULL COMMENT '跳转链接（前端路由）',
  `source_type` VARCHAR(50) DEFAULT NULL COMMENT '关联业务类型',
  `source_id` INT DEFAULT NULL COMMENT '关联业务 ID',
  `dedupe_key` VARCHAR(100) DEFAULT NULL COMMENT '去重键',
  `is_read` TINYINT DEFAULT 0 COMMENT '是否已读',
  `read_time` DATETIME DEFAULT NULL COMMENT '读取时间',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_type` (`type`),
  KEY `idx_is_read` (`is_read`),
  KEY `idx_source` (`source_type`, `source_id`),
  KEY `idx_dedupe_key` (`dedupe_key`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统消息表';


-- ============================================================
-- Phase 4 T18: 银行流水对账
-- ============================================================

-- ============================================================
-- 17. bank_statements 银行流水表
-- ============================================================
-- 用途：
--   用户从网银导出 Excel 流水后上传，系统逐条存入本表并做对账匹配
--
-- 说明：
--   1) amount 保留银行原始语义：正数收入、负数支出
--   2) batch_no 聚合同一次上传的流水，便于按批次查询对账结果
--   3) match_status 状态机：
--      unmatched（初始）→ matched（算法或手动匹配成功）/ ignored（手动忽略）
--      extra（少用，表示系统有流水无的占位条目）
--   4) match_score 用于展示匹配置信度（精确=100，模糊=70-99）
-- ============================================================
CREATE TABLE IF NOT EXISTS `bank_statements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `account_id` INT NOT NULL COMMENT '对账账户ID',
  `batch_no` VARCHAR(50) NOT NULL COMMENT '导入批次号',
  `trans_date` DATE DEFAULT NULL COMMENT '交易日期',
  `amount` DECIMAL(14,2) NOT NULL COMMENT '金额（正收负支）',
  `balance` DECIMAL(14,2) DEFAULT NULL COMMENT '交易后余额',
  `summary` VARCHAR(500) DEFAULT NULL COMMENT '摘要/用途',
  `counterparty` VARCHAR(200) DEFAULT NULL COMMENT '对方户名',
  `match_status` ENUM('unmatched','matched','extra','ignored') DEFAULT 'unmatched' COMMENT '匹配状态',
  `matched_payment_id` INT DEFAULT NULL COMMENT '匹配到的 payments.id',
  `match_score` DECIMAL(4,2) DEFAULT NULL COMMENT '匹配置信度（0-100）',
  `suggested_category_id` INT DEFAULT NULL COMMENT '建议的成本类别',
  `created_by` INT DEFAULT NULL COMMENT '上传人',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_batch_no` (`batch_no`),
  KEY `idx_match_status` (`match_status`),
  KEY `idx_trans_date` (`trans_date`),
  KEY `idx_matched_payment_id` (`matched_payment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='银行流水表';


-- ============================================================
-- 薪酬模块：业绩上传 + 工资条（feature/payroll-performance）
-- ============================================================
-- 业绩上传批次表
CREATE TABLE IF NOT EXISTS `performance_imports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `year` INT NOT NULL COMMENT '业绩归属年份',
  `month` INT NOT NULL COMMENT '业绩归属月份(1-12)',
  `file_name` VARCHAR(255) DEFAULT NULL COMMENT '上传文件名',
  `record_count` INT DEFAULT 0 COMMENT '明细条数',
  `total_performance` DECIMAL(14,2) DEFAULT 0 COMMENT '核定业绩合计',
  `status` ENUM('draft','confirmed') DEFAULT 'draft' COMMENT '状态：草稿/已确认',
  `uploaded_by` INT DEFAULT NULL COMMENT '上传人(users.id)',
  `confirmed_by` INT DEFAULT NULL COMMENT '确认人',
  `confirmed_at` DATETIME DEFAULT NULL COMMENT '确认时间',
  `remark` TEXT DEFAULT NULL COMMENT '备注',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_year_month` (`year`,`month`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业绩上传批次';

-- 业绩明细表
CREATE TABLE IF NOT EXISTS `performance_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `batch_id` INT NOT NULL COMMENT '所属上传批次ID',
  `year` INT NOT NULL COMMENT '归属年份(尾款日期所在年)',
  `month` INT NOT NULL COMMENT '归属月份(尾款日期所在月)',
  `employee_id` INT DEFAULT NULL COMMENT '匹配到的员工ID',
  `user_id` INT DEFAULT NULL COMMENT '匹配到的users.id',
  `employee_name` VARCHAR(50) NOT NULL COMMENT '上传填写的姓名',
  `business_type` VARCHAR(50) DEFAULT NULL COMMENT '业务类型',
  `serial_no` VARCHAR(100) DEFAULT NULL COMMENT '业务流水号',
  `target_no` VARCHAR(100) DEFAULT NULL COMMENT '专利号/项目号',
  `target_name` VARCHAR(500) DEFAULT NULL COMMENT '专利名/项目名',
  `contract_amount` DECIMAL(14,2) DEFAULT 0 COMMENT '合同金额',
  `performance_amount` DECIMAL(14,2) DEFAULT 0 COMMENT '核定业绩(提成基数)',
  `contract_date` DATE DEFAULT NULL COMMENT '合同日期',
  `final_payment_date` DATE DEFAULT NULL COMMENT '尾款日期',
  `is_full_risk_agent` TINYINT(1) DEFAULT 0 COMMENT '是否全风险代理(仅记录)',
  `remark` TEXT DEFAULT NULL COMMENT '备注',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_batch` (`batch_id`),
  KEY `idx_employee_month` (`employee_id`,`year`,`month`),
  KEY `idx_year_month` (`year`,`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业绩明细';

-- 专利库存表新增采购人员字段（已存在时忽略错误）
-- ALTER TABLE `patent_inventory` ADD COLUMN `purchaser_id` INT DEFAULT NULL COMMENT '采购人员(employees.id)' AFTER `created_by`;
