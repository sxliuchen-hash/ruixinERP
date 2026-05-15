-- 为 patent_inventory 表添加 reported_high_tech 字段
-- 用于标记该专利是否已报过高新技术企业认定
ALTER TABLE `patent_inventory`
ADD COLUMN `reported_high_tech` TINYINT(1) DEFAULT 0 COMMENT '是否报过高企' AFTER `remark`;
