# Technical Design: 内部财务管理系统 (Internal ERP Finance)

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nginx (erp.iptt.top)                      │
│                    SSL termination + reverse proxy                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   Frontend       │ │   Backend API    │ │  WeChat Callback │
│   Vue 3 SPA      │ │   Express :3001  │ │  /api/v1/wechat  │
│   (static files) │ │                  │ │  /callback       │
└──────────────────┘ └────────┬─────────┘ └────────┬─────────┘
                              │                     │
                    ┌─────────┼─────────────────────┘
                    │         │
              ┌─────▼─────┐ ┌▼──────────────┐
              │   Redis    │ │    MySQL       │
              │  erp:*     │ │  erp_db        │
              │  (cache)   │ │  patent_notice │
              └────────────┘ │  _system (跨库)│
                             └────────────────┘
```

### 关键架构决策

| 决策 | 方案 | 原因 |
|------|------|------|
| 前后端分离 | SPA + REST API | 与主项目一致 |
| 数据库 | 独立 erp_db + 跨库读取主项目 | 数据隔离，互不影响 |
| 认证 | 共享 JWT Secret | 两系统无缝切换 |
| 缓存 | Redis with `erp:` prefix | 与主项目共用实例不冲突 |
| 定时任务 | node-cron（进程内） | 单机部署，无需独立调度器 |
| 消息推送 | 企业微信应用消息 API | 用户已在企业微信中 |

---

## 2. Database Design

### 2.1 数据库连接策略

```javascript
// 两个 Sequelize 实例
const erpDB = new Sequelize('erp_db', ...);           // ERP 业务数据
const mainDB = new Sequelize('patent_notice_system', ...); // 只读访问用户/专利
```

### 2.2 ER Diagram (Core)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  customers  │◄────│  contracts   │────►│   suppliers     │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                    ┌──────┼──────┐               │
                    │      │      │               │
              ┌─────▼──┐ ┌─▼────┐ ┌▼─────────┐   │
              │payments│ │invoices│ │contract  │   │
              │        │ │       │ │_patents  │   │
              └────┬───┘ └───────┘ └──────────┘   │
                   │                              │
              ┌────▼────────────────┐             │
              │   bank_accounts     │             │
              └─────────────────────┘             │
                                                  │
┌──────────────────┐    ┌───────────────────┐     │
│ patent_inventory │────│ patent_annual_fees │     │
└────────┬─────────┘    └───────────────────┘     │
         │                                        │
         └──────────┐                             │
                    ▼                             │
              ┌──────────────┐                    │
              │   projects   │◄───────────────────┘
              │ (交易项目)    │
              └──────────────┘
```


### 2.3 Table Definitions

#### bank_accounts（银行账户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| name | VARCHAR(100) | 账户名称 |
| bank_name | VARCHAR(100) | 开户行 |
| account_no | VARCHAR(50) UNIQUE | 账号 |
| account_type | ENUM('public','private') | 公户/私户 |
| initial_balance | DECIMAL(12,2) | 期初余额 |
| status | TINYINT DEFAULT 1 | 1启用/0停用 |
| remark | VARCHAR(255) | 备注 |
| created_by | INT | 创建人（关联主项目users.id） |
| create_time | DATETIME | 创建时间 |
| update_time | DATETIME | 更新时间 |

#### customers（客户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| name | VARCHAR(200) NOT NULL | 客户名称 |
| contact_person | VARCHAR(50) | 联系人 |
| phone | VARCHAR(20) | 电话 |
| address | VARCHAR(500) | 地址 |
| invoice_title | VARCHAR(200) | 开票抬头 |
| tax_no | VARCHAR(50) | 税号 |
| invoice_bank | VARCHAR(100) | 开票银行 |
| invoice_account | VARCHAR(50) | 开票账号 |
| main_user_id | INT | 关联主项目users.id（业务员） |
| remark | VARCHAR(500) | 备注 |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### suppliers（供应商）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| name | VARCHAR(200) NOT NULL | 供应商名称 |
| contact_person | VARCHAR(50) | 联系人 |
| phone | VARCHAR(20) | 电话 |
| address | VARCHAR(500) | 地址 |
| bank_name | VARCHAR(100) | 开户行 |
| bank_account | VARCHAR(50) | 银行账号 |
| tax_rate | DECIMAL(4,2) | 税点（如3.00表示3个点） |
| remark | VARCHAR(500) | 备注 |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### contracts（合同）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| contract_no | VARCHAR(50) UNIQUE | 合同编号 |
| type | ENUM('sale','purchase') | 销售/采购 |
| title | VARCHAR(200) | 合同标题 |
| customer_id | INT | 客户ID（销售合同） |
| supplier_id | INT | 供应商ID（采购合同） |
| amount | DECIMAL(12,2) NOT NULL | 合同金额 |
| paid_amount | DECIMAL(12,2) DEFAULT 0 | 已收/已付金额（冗余，定期校准） |
| sign_date | DATE | 签订日期 |
| expire_date | DATE | 到期日期 |
| status | ENUM('pending','active','completed','terminated') | 状态 |
| project_id | INT | 关联交易项目 |
| attachment_url | VARCHAR(500) | 合同扫描件COS地址 |
| owner_id | INT | 负责人（关联users.id） |
| sp_no | VARCHAR(50) | 关联企业微信审批单号 |
| confirm_status | ENUM('pending','confirmed') DEFAULT 'confirmed' | 确认状态 |
| remark | TEXT | 备注 |
| created_by | INT | 创建人 |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### payments（收付款）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| type | ENUM('income','expense') | 收款/付款 |
| category | ENUM('business','fee') | 业务类/费用类 |
| amount | DECIMAL(12,2) NOT NULL | 金额 |
| payment_date | DATE NOT NULL | 收付款日期 |
| payment_method | ENUM('transfer','check','cash','other') | 方式 |
| account_id | INT NOT NULL | 银行账户ID |
| contract_id | INT | 关联合同（业务类） |
| customer_id | INT | 客户（收款时） |
| supplier_id | INT | 供应商（付款时） |
| project_id | INT | 关联交易项目 |
| cost_category_id | INT | 成本类别ID（费用类） |
| sp_no | VARCHAR(50) | 关联企业微信审批单号 |
| confirm_status | ENUM('pending','confirmed') DEFAULT 'confirmed' | 确认状态 |
| summary | VARCHAR(500) | 摘要 |
| remark | TEXT | 备注 |
| created_by | INT | 创建人 |
| create_time | DATETIME | |
| update_time | DATETIME | |

**索引**：contract_id, account_id, project_id, payment_date, sp_no, confirm_status


#### invoices（发票）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| type | ENUM('output','input') | 销项/进项 |
| invoice_type | ENUM('normal','special') | 普票/专票 |
| invoice_no | VARCHAR(50) | 发票号 |
| amount | DECIMAL(12,2) | 金额（不含税） |
| tax_amount | DECIMAL(12,2) | 税额 |
| total_amount | DECIMAL(12,2) | 价税合计 |
| invoice_date | DATE | 开票日期 |
| contract_id | INT | 关联合同 |
| customer_id | INT | 客户（销项） |
| supplier_id | INT | 供应商（进项） |
| status | ENUM('pending','issued','cancelled') | 状态 |
| sp_no | VARCHAR(50) | 关联审批单号 |
| remark | VARCHAR(500) | |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### expenses（报销）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| user_id | INT NOT NULL | 报销人（users.id） |
| amount | DECIMAL(12,2) NOT NULL | 报销金额 |
| category | VARCHAR(50) | 费用类别 |
| expense_date | DATE | 费用发生日期 |
| account_id | INT | 付款账户 |
| sp_no | VARCHAR(50) | 关联审批单号 |
| confirm_status | ENUM('pending','confirmed') DEFAULT 'confirmed' | |
| summary | VARCHAR(500) | 摘要（用于自动归类） |
| remark | TEXT | 备注 |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### loans（借款）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| user_id | INT NOT NULL | 借款人 |
| amount | DECIMAL(12,2) NOT NULL | 借款金额 |
| repaid_amount | DECIMAL(12,2) DEFAULT 0 | 已还金额 |
| loan_date | DATE | 借款日期 |
| purpose | VARCHAR(500) | 用途 |
| status | ENUM('unpaid','partial','paid') | 还款状态 |
| account_id | INT | 付款账户 |
| sp_no | VARCHAR(50) | 关联审批单号 |
| remark | TEXT | |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### loan_repayments（还款记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| loan_id | INT NOT NULL | 关联借款 |
| amount | DECIMAL(12,2) NOT NULL | 还款金额 |
| repay_date | DATE | 还款日期 |
| account_id | INT | 收款账户 |
| remark | VARCHAR(255) | |
| create_time | DATETIME | |

#### projects（交易项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| name | VARCHAR(200) NOT NULL | 项目名称 |
| patent_no | VARCHAR(50) | 关联专利号 |
| customer_id | INT | 客户 |
| supplier_id | INT | 供应商 |
| status | ENUM('active','completed','cancelled') | 状态 |
| sale_amount | DECIMAL(12,2) DEFAULT 0 | 销售收入（冗余汇总） |
| purchase_amount | DECIMAL(12,2) DEFAULT 0 | 采购成本（冗余汇总） |
| tax_cost | DECIMAL(12,2) DEFAULT 0 | 供应商税点成本 |
| maintain_cost | DECIMAL(12,2) DEFAULT 0 | 维持成本（冗余汇总） |
| gross_profit | DECIMAL(12,2) DEFAULT 0 | 毛利润（自动计算） |
| owner_id | INT | 负责人 |
| remark | TEXT | |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

**毛利润计算**：`gross_profit = sale_amount - purchase_amount - tax_cost - maintain_cost`


#### patent_inventory（专利库存）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| patent_no | VARCHAR(50) NOT NULL UNIQUE | 专利号 |
| patent_name | VARCHAR(500) NOT NULL | 专利名称 |
| patent_type | VARCHAR(20) | 专利类型（发明/实用新型/外观） |
| tech_field | VARCHAR(100) | 技术领域 |
| purchase_price | DECIMAL(12,2) | 采购价格 |
| purchase_date | DATE | 采购日期 |
| supplier_id | INT | 供应商 |
| contract_id | INT | 关联采购合同 |
| project_id | INT | 关联交易项目 |
| status | ENUM('in_stock','sold','abandoned','transferring') | 库存状态 |
| current_price | DECIMAL(12,2) | 当前售价 |
| total_maintain_cost | DECIMAL(12,2) DEFAULT 0 | 累计维持成本（冗余） |
| next_fee_deadline | DATE | 下次年费到期日 |
| stock_in_date | DATE | 入库日期 |
| stock_out_date | DATE | 出库日期 |
| remark | TEXT | |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

**库龄计算**：`DATEDIFF(NOW(), stock_in_date)` days

#### patent_annual_fees（专利年费/维持成本）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| inventory_id | INT NOT NULL | 关联专利库存 |
| fee_type | ENUM('annual','agency','other') | 费用类型 |
| amount | DECIMAL(12,2) NOT NULL | 金额 |
| fee_date | DATE | 缴费日期 |
| deadline_date | DATE | 到期日期 |
| payment_id | INT | 关联付款记录 |
| remark | VARCHAR(255) | |
| created_by | INT | |
| create_time | DATETIME | |

#### patent_price_history（专利调价历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| inventory_id | INT NOT NULL | 关联专利库存 |
| old_price | DECIMAL(12,2) | 原价 |
| new_price | DECIMAL(12,2) | 新价 |
| change_date | DATE | 调价日期 |
| reason | VARCHAR(500) | 调价原因 |
| created_by | INT | |
| create_time | DATETIME | |

#### cost_categories（成本分类）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| name | VARCHAR(50) NOT NULL | 类别名称 |
| parent_id | INT | 父类别（支持二级分类） |
| type | ENUM('labor','operation','patent','marketing','other') | 大类 |
| sort_order | INT DEFAULT 0 | 排序 |
| status | TINYINT DEFAULT 1 | 1启用/0停用 |

**预置数据**：
- 人力成本：工资、社保、公积金
- 运营成本：房租、水电、网络、物业、办公用品
- 专利维持：年费、代理费
- 营销成本：推广、获客

#### cost_records（成本记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| category_id | INT NOT NULL | 成本类别 |
| amount | DECIMAL(12,2) NOT NULL | 金额 |
| cost_month | CHAR(7) | 所属月份（2026-05） |
| user_id | INT | 关联人员（人力成本时） |
| account_id | INT | 付款账户 |
| is_recurring | TINYINT DEFAULT 0 | 是否固定月费 |
| summary | VARCHAR(500) | 摘要 |
| remark | TEXT | |
| created_by | INT | |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### wechat_approvals（企业微信审批同步记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| sp_no | VARCHAR(50) UNIQUE | 审批单号（幂等键） |
| template_id | VARCHAR(100) | 审批模板ID |
| applicant_userid | VARCHAR(100) | 申请人企业微信userid |
| applicant_name | VARCHAR(50) | 申请人姓名 |
| apply_time | DATETIME | 申请时间 |
| approve_time | DATETIME | 审批通过时间 |
| sp_status | INT | 审批状态（1审批中/2已通过/3已驳回/6已撤销） |
| sync_status | ENUM('pending','synced','failed','ignored') | 同步状态 |
| target_table | VARCHAR(50) | 写入的目标表 |
| target_id | INT | 写入的目标记录ID |
| raw_data | JSON | 原始审批数据（完整保存） |
| error_msg | VARCHAR(500) | 同步失败原因 |
| retry_count | INT DEFAULT 0 | 重试次数 |
| create_time | DATETIME | |
| update_time | DATETIME | |

#### wechat_template_mappings（审批模板映射配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| template_id | VARCHAR(100) NOT NULL | 企业微信模板ID |
| template_name | VARCHAR(100) | 模板名称（便于识别） |
| target_table | VARCHAR(50) NOT NULL | 目标表名 |
| field_mappings | JSON | 字段映射规则 |
| status | TINYINT DEFAULT 1 | 1启用/0停用 |
| create_time | DATETIME | |
| update_time | DATETIME | |

**field_mappings 示例**：
```json
[
  {"wechat_key": "金额", "db_field": "amount", "type": "decimal"},
  {"wechat_key": "客户名称", "db_field": "customer_name", "type": "string", "lookup": "customers.name"},
  {"wechat_key": "合同编号", "db_field": "contract_id", "type": "lookup", "lookup": "contracts.contract_no"}
]
```

#### classify_rules（自动归类规则）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| keyword | VARCHAR(100) NOT NULL | 关键词 |
| category_id | INT NOT NULL | 匹配的成本类别 |
| priority | INT DEFAULT 0 | 优先级（高优先） |
| status | TINYINT DEFAULT 1 | |
| create_time | DATETIME | |

#### bank_statements（银行流水导入）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| account_id | INT NOT NULL | 对账账户 |
| batch_no | VARCHAR(50) | 导入批次号 |
| trans_date | DATE | 交易日期 |
| amount | DECIMAL(12,2) | 金额（正收负支） |
| balance | DECIMAL(12,2) | 余额 |
| summary | VARCHAR(500) | 摘要 |
| counterparty | VARCHAR(200) | 对方户名 |
| match_status | ENUM('matched','unmatched','extra') | 匹配状态 |
| matched_payment_id | INT | 匹配的收付款ID |
| suggested_category_id | INT | 建议的成本类别 |
| create_time | DATETIME | |

#### account_transfers（账户间转账）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| from_account_id | INT NOT NULL | 转出账户 |
| to_account_id | INT NOT NULL | 转入账户 |
| amount | DECIMAL(12,2) NOT NULL | 转账金额 |
| transfer_date | DATE | 转账日期 |
| remark | VARCHAR(255) | |
| created_by | INT | |
| create_time | DATETIME | |

#### operation_logs（操作日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| user_id | INT NOT NULL | 操作人 |
| action | VARCHAR(50) | 操作类型（create/update/delete） |
| target_table | VARCHAR(50) | 目标表 |
| target_id | INT | 目标记录ID |
| before_data | JSON | 变更前数据 |
| after_data | JSON | 变更后数据 |
| ip_address | VARCHAR(50) | IP |
| create_time | DATETIME | |

#### system_configs（系统配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| config_key | VARCHAR(100) UNIQUE | 配置键 |
| config_value | TEXT | 配置值 |
| category | VARCHAR(50) | 分类 |
| description | VARCHAR(255) | 说明 |
| update_time | DATETIME | |


---

## 3. API Design

### 3.1 路由总览

```
/api/v1/auth            认证（复用主项目逻辑）
/api/v1/dashboard       Dashboard 数据
/api/v1/accounts        银行账户管理
/api/v1/customers       客户管理
/api/v1/suppliers       供应商管理
/api/v1/contracts       合同管理
/api/v1/payments        收付款管理
/api/v1/invoices        发票管理
/api/v1/expenses        报销管理
/api/v1/loans           借款管理
/api/v1/projects        交易项目管理
/api/v1/inventory       专利库存管理
/api/v1/costs           成本管理
/api/v1/reconciliation  银行流水对账
/api/v1/export          数据导出
/api/v1/import          数据导入
/api/v1/wechat          企业微信集成
/api/v1/config          系统配置
/api/v1/logs            操作日志
```

### 3.2 核心 API 详细设计

#### 认证
```
POST   /api/v1/auth/login          登录（验证 patent_notice_system.users）
POST   /api/v1/auth/logout         登出
GET    /api/v1/auth/profile        当前用户信息
```

#### Dashboard
```
GET    /api/v1/dashboard/overview       核心指标（现金流/利润/应收应付）
GET    /api/v1/dashboard/accounts       各账户余额
GET    /api/v1/dashboard/trend          月度趋势数据（近12个月）
GET    /api/v1/dashboard/cost-breakdown 成本构成
GET    /api/v1/dashboard/inventory      专利库存概览
GET    /api/v1/dashboard/pending        待确认单据数量
GET    /api/v1/dashboard/aging          应收账龄分布

Query params: ?period=month|quarter|year&start=2026-01&end=2026-05
```

#### 银行账户
```
GET    /api/v1/accounts             账户列表
POST   /api/v1/accounts             创建账户
PUT    /api/v1/accounts/:id         编辑账户
PUT    /api/v1/accounts/:id/balance 设置期初余额
GET    /api/v1/accounts/:id/flow    账户流水明细
POST   /api/v1/accounts/transfer    账户间转账
```

#### 合同
```
GET    /api/v1/contracts            合同列表（分页+筛选）
GET    /api/v1/contracts/:id        合同详情（含关联收付款、发票）
POST   /api/v1/contracts            创建合同
PUT    /api/v1/contracts/:id        编辑合同
DELETE /api/v1/contracts/:id        删除合同（软删除）
PUT    /api/v1/contracts/:id/status 变更状态
PUT    /api/v1/contracts/:id/confirm 确认（审批同步来的）
POST   /api/v1/contracts/:id/attachment 上传附件

Query params: ?type=sale|purchase&status=&customer_id=&page=&limit=
```

#### 收付款
```
GET    /api/v1/payments             收付款列表
GET    /api/v1/payments/:id         详情
POST   /api/v1/payments             创建收付款
PUT    /api/v1/payments/:id         编辑
DELETE /api/v1/payments/:id         删除
PUT    /api/v1/payments/:id/confirm 确认
GET    /api/v1/payments/receivable  应收汇总
GET    /api/v1/payments/payable     应付汇总

Query params: ?type=income|expense&category=business|fee&account_id=&contract_id=&project_id=
```

#### 交易项目
```
GET    /api/v1/projects             项目列表
GET    /api/v1/projects/:id         项目详情（含完整资金流向）
POST   /api/v1/projects             创建项目
PUT    /api/v1/projects/:id         编辑项目
PUT    /api/v1/projects/:id/status  变更状态
GET    /api/v1/projects/:id/profit  利润明细
```

#### 专利库存
```
GET    /api/v1/inventory            库存列表（含库龄、维持成本）
GET    /api/v1/inventory/:id        库存详情
POST   /api/v1/inventory            入库
PUT    /api/v1/inventory/:id        编辑
PUT    /api/v1/inventory/:id/status 变更状态（售出/放弃）
PUT    /api/v1/inventory/:id/price  调价
PUT    /api/v1/inventory/batch-price 批量调价
POST   /api/v1/inventory/:id/fee    添加年费记录
GET    /api/v1/inventory/overview   库存总览统计
GET    /api/v1/inventory/expiring   即将到期列表

Query params: ?status=in_stock|sold&tech_field=&min_age=&max_age=&sort=age|profit
```

#### 银行流水对账
```
POST   /api/v1/reconciliation/upload    上传银行流水Excel
GET    /api/v1/reconciliation/result/:batchNo  对账结果
POST   /api/v1/reconciliation/create-payment   从流水创建收付款
GET    /api/v1/reconciliation/history   对账历史
```

#### 企业微信
```
GET    /api/v1/wechat/callback      回调验证（echostr）
POST   /api/v1/wechat/callback      接收审批事件
GET    /api/v1/wechat/approvals     审批同步记录列表
POST   /api/v1/wechat/approvals/:id/retry  重试同步
POST   /api/v1/wechat/sync          手动触发同步
GET    /api/v1/wechat/templates     模板映射列表
PUT    /api/v1/wechat/templates/:id 编辑映射
GET    /api/v1/wechat/user-binddings 用户绑定列表
PUT    /api/v1/wechat/user-binddings/:userId 绑定企业微信userid
```

#### 数据导出
```
POST   /api/v1/export/payments      导出收支明细
POST   /api/v1/export/contracts     导出合同列表
POST   /api/v1/export/inventory     导出专利库存
POST   /api/v1/export/invoices      导出发票列表
POST   /api/v1/export/expenses      导出报销明细
```

#### 数据导入
```
GET    /api/v1/import/templates/:type  下载导入模板
POST   /api/v1/import/preview         预览导入数据（校验）
POST   /api/v1/import/execute          执行导入
GET    /api/v1/import/history          导入历史
```


---

## 4. Backend Architecture

### 4.1 目录结构

```
backend/
├── src/
│   ├── app.js                    # Express 主入口
│   ├── config/
│   │   ├── database.js           # erp_db 连接
│   │   ├── mainDatabase.js       # patent_notice_system 连接（只读）
│   │   ├── redis.js              # Redis 连接
│   │   └── wechat.js             # 企业微信配置
│   ├── models/
│   │   ├── index.js              # 模型注册 + 关联关系
│   │   ├── BankAccount.js
│   │   ├── Customer.js
│   │   ├── Supplier.js
│   │   ├── Contract.js
│   │   ├── Payment.js
│   │   ├── Invoice.js
│   │   ├── Expense.js
│   │   ├── Loan.js
│   │   ├── LoanRepayment.js
│   │   ├── Project.js
│   │   ├── PatentInventory.js
│   │   ├── PatentAnnualFee.js
│   │   ├── PatentPriceHistory.js
│   │   ├── CostCategory.js
│   │   ├── CostRecord.js
│   │   ├── WechatApproval.js
│   │   ├── WechatTemplateMapping.js
│   │   ├── ClassifyRule.js
│   │   ├── BankStatement.js
│   │   ├── AccountTransfer.js
│   │   ├── OperationLog.js
│   │   └── SystemConfig.js
│   ├── routes/
│   │   ├── index.js              # 路由注册
│   │   ├── auth.js
│   │   ├── dashboard.js
│   │   ├── accounts.js
│   │   ├── customers.js
│   │   ├── suppliers.js
│   │   ├── contracts.js
│   │   ├── payments.js
│   │   ├── invoices.js
│   │   ├── expenses.js
│   │   ├── loans.js
│   │   ├── projects.js
│   │   ├── inventory.js
│   │   ├── costs.js
│   │   ├── reconciliation.js
│   │   ├── export.js
│   │   ├── import.js
│   │   ├── wechat.js
│   │   └── config.js
│   ├── controllers/              # 同 routes 一一对应
│   ├── services/
│   │   ├── authService.js
│   │   ├── dashboardService.js
│   │   ├── contractService.js
│   │   ├── paymentService.js
│   │   ├── projectService.js     # 含利润计算逻辑
│   │   ├── inventoryService.js
│   │   ├── costService.js
│   │   ├── reconciliationService.js
│   │   ├── exportService.js
│   │   ├── importService.js
│   │   ├── wechat/
│   │   │   ├── wechatApiService.js    # 企业微信 API 调用
│   │   │   ├── wechatCryptoService.js # 消息加解密
│   │   │   ├── wechatSyncService.js   # 审批数据同步
│   │   │   ├── wechatMessageService.js # 消息推送
│   │   │   └── wechatMappingService.js # 模板映射解析
│   │   └── classifyService.js    # 自动归类
│   ├── middlewares/
│   │   ├── auth.js               # JWT 认证
│   │   ├── permission.js         # 角色权限
│   │   ├── operationLog.js       # 操作日志（异步）
│   │   ├── validate.js           # 参数校验（Joi）
│   │   └── errorHandler.js       # 全局错误处理
│   ├── jobs/
│   │   ├── index.js              # 定时任务注册
│   │   ├── wechatSyncJob.js      # 每小时同步审批
│   │   ├── feeReminderJob.js     # 每日年费到期检查
│   │   ├── contractReminderJob.js # 合同到期检查
│   │   └── recurringCostJob.js   # 固定月费自动生成
│   ├── utils/
│   │   ├── logger.js             # Winston 日志
│   │   ├── errors.js             # 自定义错误类
│   │   ├── pagination.js         # 分页工具
│   │   └── excelHelper.js        # Excel 读写工具
│   └── validators/               # Joi schema 定义
│       ├── contract.js
│       ├── payment.js
│       └── ...
├── .env                          # 环境变量
├── .env.example                  # 环境变量模板
├── package.json
└── ecosystem.config.js           # PM2 配置
```

### 4.2 中间件链

```
Request → cors → helmet → compression → auth → permission → validate → controller → response
                                                                              ↓
                                                                    operationLog (async)
```

### 4.3 认证流程

```
1. 用户登录 → 验证 patent_notice_system.users 表
2. 生成 JWT（payload: {id, username, role}）
3. 后续请求 → auth 中间件解析 JWT → 从 mainDB.users 读取用户信息
4. permission 中间件 → 根据 role 判断是否有权访问
5. ERP 不允许 client/sub_account/sub_department 角色访问
```

### 4.4 企业微信同步流程

```
┌─────────────────────────────────────────────────────────────┐
│                    回调接收流程                               │
├─────────────────────────────────────────────────────────────┤
│ 1. POST /api/v1/wechat/callback                             │
│ 2. wechatCryptoService.decrypt(body) → XML                  │
│ 3. 解析事件类型 = sys_approval_change                        │
│ 4. 提取 sp_no, sp_status                                    │
│ 5. if sp_status == 2 (已通过):                              │
│    a. wechatApiService.getApprovalDetail(sp_no)             │
│    b. wechatMappingService.mapToRecord(detail, template_id) │
│    c. 写入 wechat_approvals 表 (sync_status='synced')       │
│    d. 写入目标业务表 (confirm_status='pending')              │
│ 6. 返回 "success"                                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    定时兜底流程（每小时）                      │
├─────────────────────────────────────────────────────────────┤
│ 1. wechatApiService.getApprovalInfo(starttime, endtime)     │
│ 2. 过滤出 wechat_approvals 表中不存在的 sp_no               │
│ 3. 逐条调用 getApprovalDetail                               │
│ 4. 同回调流程步骤 5                                          │
│ 5. 控制请求频率（≤10次/秒，避免触发限流）                    │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 利润计算逻辑

```javascript
// projectService.js
function calculateProfit(project) {
  // 毛利润（交易层面）
  const grossProfit = project.sale_amount 
    - project.purchase_amount 
    - project.tax_cost 
    - project.maintain_cost;
  
  return grossProfit;
}

// dashboardService.js
function calculateNetProfit(period) {
  // 净利润（公司层面）
  const totalGrossProfit = sum(completedProjects.grossProfit);
  const totalLabor = sum(costRecords.where(type='labor', period));
  const totalOperation = sum(costRecords.where(type='operation', period));
  const totalOther = sum(costRecords.where(type='other', period));
  
  return totalGrossProfit - totalLabor - totalOperation - totalOther;
}
```

### 4.6 银行流水对账算法

```
1. 解析 Excel → bank_statements 表
2. 对每条流水，按以下规则匹配 payments 表：
   a. 精确匹配：金额相同 + 日期相同（±1天）
   b. 模糊匹配：金额相同 + 日期相近（±3天）+ 摘要相似
3. 匹配结果：
   - matched: 流水和系统记录一一对应
   - unmatched: 流水有但系统无（可能漏记）
   - extra: 系统有但流水无（可能录错）
4. 对 unmatched 的流水，调用 classifyService 建议类别
```


---

## 5. Frontend Architecture

### 5.1 目录结构

```
frontend/
├── src/
│   ├── main.js                   # 入口
│   ├── App.vue                   # 根组件
│   ├── router/
│   │   └── index.js              # 路由定义 + 权限守卫
│   ├── stores/
│   │   ├── user.js               # 用户状态
│   │   ├── app.js                # 应用全局状态
│   │   └── dashboard.js          # Dashboard 数据缓存
│   ├── api/
│   │   ├── request.js            # Axios 封装（JWT 拦截器）
│   │   ├── auth.js
│   │   ├── dashboard.js
│   │   ├── account.js
│   │   ├── customer.js
│   │   ├── supplier.js
│   │   ├── contract.js
│   │   ├── payment.js
│   │   ├── invoice.js
│   │   ├── expense.js
│   │   ├── loan.js
│   │   ├── project.js
│   │   ├── inventory.js
│   │   ├── cost.js
│   │   ├── reconciliation.js
│   │   ├── wechat.js
│   │   └── config.js
│   ├── views/
│   │   ├── Login.vue
│   │   ├── Dashboard.vue         # 首页看板
│   │   ├── account/              # 银行账户
│   │   ├── contract/             # 合同管理
│   │   ├── payment/              # 收付款
│   │   ├── invoice/              # 发票
│   │   ├── expense/              # 报销
│   │   ├── loan/                 # 借款
│   │   ├── project/              # 交易项目
│   │   ├── inventory/            # 专利库存
│   │   ├── cost/                 # 成本管理
│   │   ├── customer/             # 客户
│   │   ├── supplier/             # 供应商
│   │   ├── reconciliation/       # 银行对账
│   │   ├── import/               # 数据导入
│   │   └── system/               # 系统设置（模板映射/归类规则/用户绑定）
│   ├── components/
│   │   ├── layout/
│   │   │   ├── MainLayout.vue    # 主布局（侧边栏+顶栏+系统切换）
│   │   │   ├── Sidebar.vue       # 侧边导航
│   │   │   └── SystemSwitch.vue  # 系统切换按钮
│   │   ├── common/
│   │   │   ├── Pagination.vue
│   │   │   ├── ConfirmDialog.vue # 二次确认弹窗
│   │   │   └── ExportButton.vue
│   │   ├── dashboard/
│   │   │   ├── StatCard.vue      # 指标卡片
│   │   │   ├── TrendChart.vue    # 趋势图
│   │   │   ├── CostPieChart.vue  # 成本饼图
│   │   │   └── AgingChart.vue    # 账龄分布
│   │   └── business/
│   │       ├── ContractSelect.vue
│   │       ├── AccountSelect.vue
│   │       ├── CustomerSelect.vue
│   │       └── ProjectSelect.vue
│   └── utils/
│       ├── format.js             # 金额/日期格式化
│       ├── permission.js         # 前端权限判断
│       └── constants.js          # 枚举常量
├── index.html
├── vite.config.js
└── package.json
```

### 5.2 路由设计

```javascript
const routes = [
  { path: '/login', component: Login, meta: { public: true } },
  {
    path: '/',
    component: MainLayout,
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: Dashboard },
      // 核心业务
      { path: 'contracts', component: ContractList },
      { path: 'contracts/:id', component: ContractDetail },
      { path: 'payments', component: PaymentList },
      { path: 'invoices', component: InvoiceList },
      { path: 'expenses', component: ExpenseList },
      { path: 'loans', component: LoanList },
      // 分析
      { path: 'projects', component: ProjectList },
      { path: 'projects/:id', component: ProjectDetail },
      { path: 'inventory', component: InventoryList },
      { path: 'inventory/:id', component: InventoryDetail },
      { path: 'costs', component: CostList },
      // 基础数据
      { path: 'accounts', component: AccountList },
      { path: 'customers', component: CustomerList },
      { path: 'suppliers', component: SupplierList },
      // 工具
      { path: 'reconciliation', component: ReconciliationPage },
      { path: 'import', component: ImportPage },
      // 系统（仅 admin）
      { path: 'system/templates', component: TemplateMappings, meta: { role: 'admin' } },
      { path: 'system/classify-rules', component: ClassifyRules, meta: { role: 'admin' } },
      { path: 'system/wechat-binddings', component: WechatBinddings, meta: { role: 'admin' } },
      { path: 'system/logs', component: OperationLogs, meta: { role: 'admin' } },
    ]
  }
];
```

### 5.3 系统切换组件

```vue
<!-- SystemSwitch.vue -->
<!-- 顶部导航栏右侧，显示当前系统名称 + 切换按钮 -->
<!-- 点击后 window.open('https://iptt.top', '_blank') 跳转主项目 -->
<!-- Token 存在 localStorage，两个域名共享（需设置同源或通过 URL 传递） -->
```

**Token 共享方案**：
- 方案：切换时 URL 带 `?token=xxx`，目标系统接收后存入 localStorage
- 安全：Token 有效期内可用，HTTPS 传输

---

## 6. Deployment

### 6.1 Nginx 配置

```nginx
server {
    listen 443 ssl;
    server_name erp.iptt.top;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端静态文件
    location / {
        root /www/wwwroot/erp/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 文件上传大小限制
    client_max_body_size 20m;
}

# HTTP 重定向
server {
    listen 80;
    server_name erp.iptt.top;
    return 301 https://$host$request_uri;
}
```

### 6.2 PM2 配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'erp-backend',
    script: 'src/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};
```

### 6.3 环境变量 (.env)

```bash
# 应用
NODE_ENV=production
PORT=3001
APP_NAME=ERP财务管理系统

# ERP 数据库
DB_HOST=localhost
DB_PORT=3306
DB_NAME=erp_db
DB_USER=root
DB_PASSWORD=****

# 主项目数据库（只读）
MAIN_DB_HOST=localhost
MAIN_DB_PORT=3306
MAIN_DB_NAME=patent_notice_system
MAIN_DB_USER=root
MAIN_DB_PASSWORD=****

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PREFIX=erp:

# JWT（与主项目相同）
JWT_SECRET=same_as_main_project
JWT_EXPIRES_IN=24h

# 企业微信
WECHAT_CORP_ID=your_corp_id
WECHAT_APPROVAL_SECRET=your_approval_secret
WECHAT_CALLBACK_TOKEN=your_callback_token
WECHAT_CALLBACK_AES_KEY=your_aes_key
WECHAT_AGENT_ID=your_agent_id

# 腾讯云 COS
COS_SECRET_ID=****
COS_SECRET_KEY=****
COS_BUCKET=erp-attachments-xxx
COS_REGION=ap-guangzhou

# 前端地址
FRONTEND_URL=https://erp.iptt.top
MAIN_SYSTEM_URL=https://iptt.top

# 日志
LOG_LEVEL=info
LOG_DIR=./logs
```

---

## 7. Key Technical Decisions

| 决策 | 选择 | 备选 | 原因 |
|------|------|------|------|
| ORM | Sequelize | Prisma | 与主项目一致，降低学习成本 |
| 定时任务 | node-cron | Bull Queue | 单机部署，任务简单，无需分布式队列 |
| Excel处理 | exceljs | xlsx | 主项目已用 exceljs，API 更友好 |
| 图表 | ECharts | Chart.js | 功能更强，中文支持好 |
| 企业微信加解密 | 自实现 | @wecom/crypto | npm 包维护不活跃，自实现更可控 |
| 文件存储 | 腾讯云 COS | 本地磁盘 | 可靠性高，与主项目方案一致 |
| Token共享 | URL参数传递 | Cookie共享 | 跨子域名，Cookie方案需额外配置 |

---

## 8. Security Considerations

- JWT 认证所有 API（除 /wechat/callback）
- 企业微信回调通过签名验证确保来源可信
- 敏感操作（删除、金额修改）记录操作日志 + 前端二次确认
- SQL 注入防护：Sequelize 参数化查询
- XSS 防护：helmet 中间件 + 前端输入转义
- 文件上传：类型白名单 + 大小限制
- 接口限流：express-rate-limit（全局 100次/分钟）
- 跨库访问主项目数据库使用只读账号（生产环境建议）

---

## 9. Performance Optimization

- Dashboard 数据 Redis 缓存（TTL 5分钟，写操作时主动失效）
- 列表查询分页（默认 20 条/页）
- 合同 paid_amount、项目 gross_profit 等冗余字段避免实时聚合
- 操作日志异步写入（setImmediate）
- 银行流水对账为后台任务，大文件分批处理
- 前端路由懒加载，减少首屏体积
