# Tasks: 内部财务管理系统 (Internal ERP Finance)

## Task Dependency Graph

```
Phase 1: 基础框架
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8

Phase 2: 企业微信集成
T9 → T10 → T11 → T12 → T13

Phase 3: 专利库存 + 分析
T14 → T15 → T16 → T17

Phase 4: 工具 + 增强
T18 → T19 → T20 → T21 → T22

依赖关系:
T1 (项目骨架) ← 所有后续任务
T2 (认证) ← T3-T22
T3 (账户) ← T5, T7, T12, T18
T4 (客户供应商) ← T5, T6
T5 (合同) ← T6, T7, T14, T16
T7 (收付款) ← T8, T14, T16, T18
T9 (企业微信基础) ← T10, T11
T14 (专利库存) ← T15, T17
T16 (交易项目) ← T8 (Dashboard利润)
```

---

## Phase 1: 基础框架 + 核心数据（2-3周）


### Task 1: 项目骨架搭建
- [x] **Status**: completed

**Description**: 搭建前后端项目基础结构，配置开发环境。

**Subtasks**:
- [x] 1.1 初始化后端项目（Express + Sequelize + MySQL + Redis）
  - package.json 依赖安装
  - src/ 目录结构创建
  - app.js 主入口（中间件注册、路由挂载）
  - config/database.js（erp_db 连接）
  - config/mainDatabase.js（patent_notice_system 只读连接）
  - config/redis.js（key 前缀 `erp:`）
  - utils/logger.js（Winston）
  - utils/errors.js（自定义错误类）
  - middlewares/errorHandler.js
  - .env + .env.example
  - ecosystem.config.js（PM2）
- [x] 1.2 初始化前端项目（Vue 3 + Vite + Element Plus + ECharts）
  - `npm create vite@latest frontend -- --template vue`
  - 安装依赖：element-plus, pinia, vue-router, axios, echarts
  - src/ 目录结构创建
  - main.js 入口配置
  - vite.config.js（proxy 到 3001）
  - api/request.js（Axios 封装 + JWT 拦截器）
- [x] 1.3 创建 erp_db 数据库 + 基础表
  - 创建数据库 `CREATE DATABASE erp_db`
  - system_configs 表
  - operation_logs 表
  - cost_categories 表（含预置数据）
  - classify_rules 表（含预置关键词）
- [x] 1.4 前端主布局
  - MainLayout.vue（侧边栏 + 顶栏）
  - Sidebar.vue（导航菜单）
  - SystemSwitch.vue（系统切换按钮）
  - router/index.js（路由定义 + 权限守卫）
- [x] 1.5 操作日志中间件
  - middlewares/operationLog.js（异步记录）

**Relates to**: Requirement 19 (系统切换)

---

### Task 2: 用户认证与权限
- [x] **Status**: completed

**Description**: 复用主项目用户体系，实现 JWT 认证和角色权限控制。

**Subtasks**:
- [x] 2.1 认证模块
  - routes/auth.js + controllers/authController.js
  - services/authService.js（从 mainDB.users 验证）
  - middlewares/auth.js（JWT 解析）
  - POST /login, POST /logout, GET /profile
- [x] 2.2 权限中间件
  - middlewares/permission.js
  - 角色判断：admin/process/agent 可访问，其他拒绝
  - 数据隔离：agent 只看自己的数据
- [x] 2.3 前端登录页
  - views/Login.vue
  - stores/user.js（Pinia 用户状态）
  - 路由守卫（未登录跳转登录页）
  - Token 存储 + 过期处理

**Relates to**: Requirement 18, 19, 20

---

### Task 3: 银行账户管理
- [x] **Status**: completed

**Description**: 实现多账户管理，支持期初余额设置和余额自动计算。

**Subtasks**:
- [x] 3.1 后端
  - models/BankAccount.js
  - models/AccountTransfer.js
  - routes/accounts.js + controller + service
  - 余额计算逻辑：期初余额 + 收入 - 支出
  - 账户间转账 API
- [x] 3.2 前端
  - views/account/AccountList.vue
  - 账户 CRUD 弹窗
  - 期初余额设置
  - 账户流水查看
  - components/business/AccountSelect.vue（通用选择器）

**Relates to**: Requirement 3

---

### Task 4: 客户与供应商管理
- [x] **Status**: completed

**Description**: 实现客户和供应商的 CRUD 及往来账查看。

**Subtasks**:
- [x] 4.1 后端
  - models/Customer.js + models/Supplier.js
  - routes/customers.js + routes/suppliers.js
  - controllers + services
  - 往来账汇总 API（关联合同和收付款统计）
- [x] 4.2 前端
  - views/customer/CustomerList.vue
  - views/supplier/SupplierList.vue
  - CRUD 弹窗（含开票信息、税点等）
  - 往来账详情页
  - components/business/CustomerSelect.vue
  - components/business/SupplierSelect.vue

**Relates to**: Requirement 17


---

### Task 5: 合同管理
- [x] **Status**: completed

**Description**: 实现销售合同和采购合同的完整管理，含执行进度跟踪。

**Subtasks**:
- [x] 5.1 后端
  - models/Contract.js
  - routes/contracts.js + controller + service
  - CRUD API + 状态变更 + 确认
  - 执行进度计算（paid_amount / amount）
  - 附件上传（COS）
  - 数据权限：agent 只看 owner_id = 自己的
- [x] 5.2 前端
  - views/contract/ContractList.vue（分页 + 筛选：类型/状态/客户）
  - views/contract/ContractDetail.vue（详情 + 关联收付款/发票列表）
  - 合同创建/编辑表单
  - 进度条展示
  - 附件上传组件
  - components/business/ContractSelect.vue

**Relates to**: Requirement 4

---

### Task 6: 发票管理
- [x] **Status**: completed

**Description**: 实现开票和收票记录管理，含供应商税点计算。

**Subtasks**:
- [x] 6.1 后端
  - models/Invoice.js
  - routes/invoices.js + controller + service
  - CRUD API + 状态变更
  - 税点计算：根据供应商 tax_rate 自动算税额
- [x] 6.2 前端
  - views/invoice/InvoiceList.vue
  - 发票创建/编辑表单（关联合同、客户/供应商）
  - 开票状态管理

**Relates to**: Requirement 6

---

### Task 7: 收付款管理
- [x] **Status**: completed

**Description**: 实现收付款记录管理，区分业务类和费用类，含应收应付统计。

**Subtasks**:
- [x] 7.1 后端
  - models/Payment.js
  - routes/payments.js + controller + service
  - CRUD API + 确认操作
  - 业务类：关联合同，更新合同 paid_amount
  - 费用类：关联成本类别，写入 cost_records
  - 应收/应付汇总 API
  - 账户余额联动更新
- [x] 7.2 前端
  - views/payment/PaymentList.vue（分页 + 筛选：类型/类别/账户/合同）
  - 收付款创建表单（业务类/费用类切换）
  - 待确认列表（审批同步来的）
  - 应收/应付汇总页面

**Relates to**: Requirement 5

---

### Task 8: 基础 Dashboard
- [x] **Status**: completed

**Description**: 实现 Dashboard 首页，展示核心财务指标和图表。

**Subtasks**:
- [x] 8.1 后端
  - routes/dashboard.js + controller + service
  - GET /overview：现金流入/流出/净额、应收/应付
  - GET /accounts：各账户余额
  - GET /trend：近12个月收支趋势
  - GET /cost-breakdown：成本构成
  - GET /pending：待确认数量
  - Redis 缓存（TTL 5分钟）
- [x] 8.2 前端
  - views/Dashboard.vue
  - components/dashboard/StatCard.vue（指标卡片）
  - components/dashboard/TrendChart.vue（ECharts 折线图）
  - components/dashboard/CostPieChart.vue（ECharts 饼图）
  - 时间范围切换（本月/本季/本年）
  - 待确认单据提醒区域

**Relates to**: Requirement 13


---

## Phase 2: 企业微信集成 + 报销借款（2周）

### Task 9: 企业微信基础集成
- [ ] **Status**: pending

**Description**: 实现企业微信回调接收、消息加解密、API 调用基础能力。

**Subtasks**:
- [ ] 9.1 企业微信配置
  - config/wechat.js（CorpID, Secret, Token, AESKey）
  - services/wechat/wechatCryptoService.js（AES-256-CBC 加解密）
  - services/wechat/wechatApiService.js（获取 access_token、调用审批接口）
- [ ] 9.2 回调接口
  - routes/wechat.js
  - GET /callback（验证 echostr）
  - POST /callback（接收事件、解密、分发）
- [ ] 9.3 用户匹配
  - 主项目 users 表增加 `wechat_work_userid` 字段（ALTER TABLE）
  - 管理后台绑定页面
  - services/wechat/wechatApiService.js 增加用户匹配逻辑

**Relates to**: Requirement 1, 20

---

### Task 10: 审批模板映射 + 数据同步
- [ ] **Status**: pending

**Description**: 实现审批模板字段映射配置和审批数据自动同步。

**Subtasks**:
- [ ] 10.1 后端
  - models/WechatApproval.js + models/WechatTemplateMapping.js
  - services/wechat/wechatMappingService.js（解析映射规则，转换数据）
  - services/wechat/wechatSyncService.js（同步主逻辑）
  - 同步流程：接收事件 → 获取详情 → 映射字段 → 写入业务表（confirm_status='pending'）
  - 幂等去重（sp_no unique）
  - 同步失败记录 + 重试机制
- [ ] 10.2 定时兜底任务
  - jobs/wechatSyncJob.js（每小时执行）
  - 拉取最近2小时审批 → 过滤已同步 → 逐条同步
  - 请求频率控制（≤10次/秒）
- [ ] 10.3 管理后台
  - views/system/TemplateMappings.vue（模板映射配置页）
  - views/system/WechatApprovals.vue（同步记录列表 + 重试按钮）

**Relates to**: Requirement 1, 2

---

### Task 11: 企业微信消息推送
- [ ] **Status**: pending

**Description**: 实现通过企业微信应用消息推送提醒（年费到期、合同到期）。

**Subtasks**:
- [ ] 11.1 推送服务
  - services/wechat/wechatMessageService.js
  - 调用企业微信 message/send 接口
  - 支持文本卡片消息（含跳转链接）
- [ ] 11.2 集成到提醒任务（Phase 3 使用）

**Relates to**: Requirement 9

---

### Task 12: 报销与借款管理
- [x] **Status**: completed

**Description**: 实现报销和借款的完整管理，含还款跟踪。

**Subtasks**:
- [x] 12.1 后端
  - models/Expense.js + models/Loan.js + models/LoanRepayment.js
  - routes/expenses.js + routes/loans.js
  - controllers + services
  - 报销 CRUD + 费用统计（按类别/人/月）
  - 借款 CRUD + 还款记录 + 状态自动更新
  - 关联付款账户
- [x] 12.2 前端
  - views/expense/ExpenseList.vue（含费用统计图表）
  - views/loan/LoanList.vue（含还款状态）
  - 还款操作弹窗

**Relates to**: Requirement 7

---

### Task 13: 自动识别归类
- [ ] **Status**: pending

**Description**: 实现基于关键词的费用自动归类功能。

**Subtasks**:
- [ ] 13.1 后端
  - models/ClassifyRule.js
  - services/classifyService.js
  - 匹配逻辑：遍历规则，按优先级匹配摘要中的关键词
  - 集成到审批同步流程（报销/费用类支出自动建议类别）
- [ ] 13.2 前端
  - views/system/ClassifyRules.vue（规则管理页）
  - 归类结果展示（建议标签 + 确认按钮）

**Relates to**: Requirement 16


---

## Phase 3: 专利库存 + 交易项目 + 成本（2周）

### Task 14: 专利库存管理
- [x] **Status**: completed

**Description**: 实现囤积专利的库存管理，含库龄、维持成本、调价。

**Subtasks**:
- [x] 14.1 后端
  - models/PatentInventory.js + models/PatentAnnualFee.js + models/PatentPriceHistory.js
  - routes/inventory.js + controller + service
  - 入库 API（手动录入）
  - 库龄计算（DATEDIFF）
  - 维持成本汇总（SUM annual_fees）
  - 调价 API + 批量调价
  - 利润预估计算
  - 库存总览统计 API
  - 即将到期列表 API
- [x] 14.2 前端
  - views/inventory/InventoryList.vue（含库龄、维持成本、利润预估列）
  - views/inventory/InventoryDetail.vue(详情 + 年费记录 + 调价历史)
  - 入库表单
  - 批量调价弹窗
  - 筛选：状态/技术领域/库龄范围

**Relates to**: Requirement 8

---

### Task 15: 年费到期提醒
- [x] **Status**: completed (系统消息部分；企微推送待 T11 凭证就绪后接入)

**Description**: 实现专利年费和合同到期的定时检查和系统消息通知（企微推送延后）。

**Subtasks**:
- [x] 15.1 定时任务
  - jobs/feeReminderJob.js（每日 9:00 执行）
  - 查询 next_fee_deadline 在 60/30/7 天内的在库专利（复用 inventoryService.getExpiring）
  - 按 dedupe_key 幂等去重（同一专利同天同阈值仅生成一次）
  - 当前写入 notifications 表；T11 上线后追加 wechatMessageService 推送
- [x] 15.2 合同到期提醒
  - jobs/contractReminderJob.js（每日 9:00 执行）
  - 查询 expire_date 在 30 天内的 active 合同
  - 消息发送给 owner；owner 为空时广播 admin
- [x] 15.3 系统消息中心
  - models/Notification.js + notifications 表
  - services/notificationService.js（upsert/broadcast/getList/markRead/cleanup）
  - routes/notifications.js（5 路由）+ controller + validator
- [x] 15.4 前端消息中心
  - components/layout/NotificationBell.vue（顶栏铃铛 + badge + 抽屉）
  - 60 秒轮询未读数；点击消息自动已读 + 跳转 link
  - 类型筛选 + 仅未读 + 批量已读 + 删除

**Relates to**: Requirement 9

---

### Task 16: 交易项目管理
- [x] **Status**: completed

**Description**: 实现交易项目的创建和单笔利润核算。

**Subtasks**:
- [x] 16.1 后端
  - models/Project.js
  - services/projectService.js
  - CRUD API
  - 利润计算：sale_amount - purchase_amount - tax_cost - maintain_cost
  - 关联聚合：从 contracts + payments + annual_fees 汇总
  - 状态自动判断：所有合同完成 → 项目完成
- [x] 16.2 前端
  - views/project/ProjectList.vue（含利润列、状态筛选）
  - views/project/ProjectDetail.vue（资金流向图：收入/采购/税点/维持/利润）
  - 项目创建表单（关联专利、客户、供应商）
  - components/business/ProjectSelect.vue
- [x] 16.3 Dashboard 利润更新
  - dashboardService 增加毛利润/净利润计算
  - 前端 Dashboard 增加利润双口径展示

**Relates to**: Requirement 10

---

### Task 17: 成本管理
- [x] **Status**: completed

**Description**: 实现各类成本的录入、固定月费自动生成、统计分析。

**Subtasks**:
- [x] 17.1 后端
  - models/CostCategory.js + models/CostRecord.js
  - routes/costs.js + controller + service
  - 成本录入 CRUD
  - 固定月费自动生成（jobs/recurringCostJob.js，每月1日）
  - 专利维持成本自动汇总（从 patent_annual_fees 聚合）
  - 按月/季/年汇总 API + 同比环比
- [x] 17.2 前端
  - views/cost/CostList.vue（按月展示，含分类小计）
  - 成本录入表单（人力按人、运营按类别）
  - 固定月费设置
  - 成本趋势图 + 占比饼图
- [x] 17.3 Dashboard 成本更新
  - Dashboard 成本构成饼图数据源接入
  - 净利润计算接入成本数据

**Relates to**: Requirement 11


---

## Phase 4: 工具 + 增强（1-2周）

### Task 18: 银行流水对账
- [x] **Status**: completed

**Description**: 实现银行流水 Excel 导入和自动对账功能。

**Subtasks**:
- [x] 18.1 后端
  - models/BankStatement.js
  - routes/reconciliation.js + controller + service
  - Excel 解析（exceljs，灵活列映射，支持正负合并列/收入支出分列）
  - 匹配算法：金额精确 + 日期 ±1 天 → 精确；±3 天 + 摘要 bigram 相似度 → 模糊；阈值 60 分
  - 对账结果生成（matched/unmatched/extra/ignored）
  - 从流水一键创建收付款记录（复用 paymentService.create，联动合同 + cost_record）
  - 手动匹配 / 解除匹配 / 忽略
  - 自动归类建议（基于 classify_rules）
  - 对账历史保存（批次聚合）
- [x] 18.2 前端
  - views/reconciliation/ReconciliationPage.vue（3 Tab：新建/结果/历史）
  - 上传向导：拖拽 Excel + 字段列映射配置 + 表头行号
  - 对账结果三栏对比：已匹配 / 未匹配流水 / 系统多出
  - 未匹配项操作：创建付款 / 忽略
  - 已匹配项：解除
  - 对账历史列表 + 删除批次

**Relates to**: Requirement 12

---

### Task 19: 数据导出
- [x] **Status**: completed

**Description**: 实现各类数据的 Excel 导出功能。

**Subtasks**:
- [x] 19.1 后端
  - routes/export.js + controller + service
  - 导出收支明细（含筛选条件）
  - 导出合同列表
  - 导出专利库存清单（含库龄、维持成本、利润预估）
  - 导出发票列表、报销明细
  - exceljs 生成 .xlsx（含表头格式化）
- [x] 19.2 前端
  - components/common/ExportButton.vue（通用导出按钮）
  - 各列表页集成导出功能
  - 导出前筛选条件确认弹窗

**Relates to**: Requirement 14

---

### Task 20: 历史数据迁移
- [x] **Status**: completed

**Description**: 实现 Excel 批量导入功能，支持约 2000 条历史数据迁移。

**Subtasks**:
- [x] 20.1 后端
  - routes/import.js + controller + service
  - 导入模板生成（各业务表对应的 Excel 模板）
  - 数据校验：必填检查、格式检查、重复检查（contract_no/patent_no）
  - 批量写入（事务包裹，失败回滚）
  - 导入结果报告生成
  - 支持的导入类型：合同、收付款、专利库存、成本记录
- [x] 20.2 前端
  - views/import/ImportPage.vue
  - 模板下载按钮
  - 上传 Excel + 预览校验结果
  - 确认导入 + 结果展示（成功/失败明细）

**Relates to**: Requirement 15

---

### Task 21: 系统切换与导航集成
- [x] **Status**: completed

**Description**: 实现两个系统间的无缝切换。

**Subtasks**:
- [x] 21.1 ERP 端
  - SystemSwitch.vue 完善（跳转到 https://iptt.top?token=xxx）
  - 接收 URL 中的 token 参数并存储
  - 前端 .env 配置 VITE_MAIN_SYSTEM_URL
- [x] 21.2 主项目端（需修改 patent-notice-system）
  - 集成指南文档已编写（docs/T21-main-project-integration.md）
  - MainLayout.vue 顶栏增加"ERP 财务"入口
  - 跳转到 https://erp.iptt.top?token=xxx
  - 仅 admin/process/agent 角色显示入口

**Relates to**: Requirement 19

---

### Task 22: 部署上线
- [x] **Status**: completed

**Description**: 完成生产环境部署和上线准备。

**Subtasks**:
- [x] 22.1 服务器配置
  - Nginx 配置文件（deploy/nginx.conf）：SSL + 静态文件 + API 反向代理 + Gzip
  - 部署脚本（deploy/deploy.sh）：自动化拉取/构建/重启
  - 生产环境 .env 模板（backend/.env.production）
  - PM2 配置（ecosystem.config.js）已就绪
  - 前端 .env.production 配置
- [x] 22.2 企业微信配置
  - 企业微信回调 URL 文档：https://erp.iptt.top/api/v1/wechat/callback
  - Token + EncodingAESKey 占位已在 .env.production
  - 审批模板 ID 已配置
  - 应用消息推送权限说明在 T21 集成指南中
- [x] 22.3 数据初始化
  - init-database.sql 包含全部表结构 + 预置数据
  - 历史数据通过 T20 ImportPage 导入
  - 部署脚本支持 --init-db 参数首次初始化
- [ ] 22.4 验证测试（需部署后执行）
  - 企业微信回调连通性测试
  - 审批同步端到端测试
  - Dashboard 数据准确性验证
  - 各角色权限验证

**Relates to**: All Requirements

---

## Summary

| Phase | Tasks | 预估周期 | 核心交付 |
|-------|-------|---------|---------|
| Phase 1 | T1-T8 | 2-3周 | 可用的基础系统（账户+合同+收付款+Dashboard） |
| Phase 2 | T9-T13 | 2周 | 企业微信打通 + 报销借款 + 自动归类 |
| Phase 3 | T14-T17 | 2周 | 专利库存 + 交易利润 + 成本分析 |
| Phase 4 | T18-T22 | 1-2周 | 对账+导出+迁移+部署上线 |
| **合计** | **22 Tasks** | **7-9周** | **完整的内部财务管理系统** |
