-- 已售专利归档功能 - 新增销售详情字段
-- 日期: 2025-05-26

ALTER TABLE `patent_inventory`
  ADD COLUMN `sold_time` datetime DEFAULT NULL COMMENT '成交时间' AFTER `stock_out_date`,
  ADD COLUMN `sold_price` decimal(12,2) DEFAULT NULL COMMENT '成交价格' AFTER `sold_time`,
  ADD COLUMN `buyer_name` varchar(100) DEFAULT NULL COMMENT '买家名称' AFTER `sold_price`,
  ADD COLUMN `buyer_contact` varchar(100) DEFAULT NULL COMMENT '买家联系方式' AFTER `buyer_name`,
  ADD COLUMN `sale_contract_id` int(11) DEFAULT NULL COMMENT '关联销售合同ID' AFTER `buyer_contact`,
  ADD COLUMN `sale_remark` text DEFAULT NULL COMMENT '销售备注' AFTER `sale_contract_id`,
  ADD COLUMN `actual_profit` decimal(12,2) DEFAULT NULL COMMENT '实际利润(成交价-采购价-维护成本)' AFTER `sale_remark`;

-- 索引优化
ALTER TABLE `patent_inventory`
  ADD INDEX `idx_sold_time` (`sold_time`),
  ADD INDEX `idx_status_sold_time` (`status`, `sold_time`);
