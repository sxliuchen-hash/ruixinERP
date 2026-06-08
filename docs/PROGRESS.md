# 内部财务管理系统 - 开发进度文档

> 最后更新：2026-06-08
> 维护者：单会话接管开发

---

## 🆕 2026-06（人力薪资深化 + 安全增强）

> 注：本节为 2026-05-19 之后的增量更新。期间已陆续完成人力薪资（T-HR 系列）、
> IP 系统年费代查对接、已售专利归档统计等模块，详见 git 提交记录。

| # | 任务 | 后端 | 前端 | 状态 |
|---|------|------|------|------|
| T-HR1 | 员工档案 | Employee 模型 + CRUD | EmployeeList | ✅ |
| T-HR2 | 薪资规则配置 | SalaryRule + salaryRuleService | SalaryRules（5 面板） | ✅ |
| T-HR3 | 业绩统计看板 | performanceService（按人按月聚合/排名/趋势/季度考核） | PerformanceDashboard | ✅ |
| T-HR4 | 工资条生成 | payrollService（基础薪资+津贴+提成-社保-请假） | PayrollList | ✅ |
| SEC-1 | 敏感页防泄露水印 | — | Watermark 组件 + 路由 meta.watermark | ✅ 2026-06-08 |
| UX-1 | 人力薪资独立子菜单 | — | Sidebar 重构 | ✅ 2026-06-08 |

**进行中（需求已确认，分阶段实现）**：薪酬模块重构 —— 业绩统计表上传计提 + 采购提成
（卖出时间衰减）+ 个税（简化版）+ 考勤扣款（事假/病假法定）+ 工资条作废/调整。
详细设计见 `docs/薪酬模块-业绩上传与工资条设计.md`。

**SEC-1 水印关键点**：
- Canvas 平铺生成水印背景，文案 = 姓名@账号 + 手机尾号 + 日期
- MutationObserver 防篡改（DevTools 删 DOM / 改样式自动恢复）
- 生效页：工资条 / 业绩统计 / 薪资规则 / 员工档案（路由 meta.watermark 控制）

---

## 📊 总体进度

| 阶段 | 任务数 | 已完成 | 进行中 | 未开始 | 进度 |
|------|--------|--------|--------|--------|------|
| Phase 1: 基础框架 | 8 | 8 | 0 | 0 | ████████ 100% ✅ |
| Phase 2: 企业微信集成 | 5 | 1 | 0 | 4 | █▓░░░░░░ 20% |
| Phase 3: 专利库存+分析 | 4 | 4 | 0 | 0 | ████████ 100% ✅ |
| Phase 4: 工具+增强 | 5 | 5 | 0 | 0 | ████████ 100% ✅ |
| Phase 5: 专利库存深化（IP 系统对接） | 5 | 5 | 0 | 0 | ████████ 100% ✅ |
| **合计** | **27** | **23** | **0** | **4** | **85%** |

## 🆕 Phase 5（2026-05）：专利库存与 IP 系统深度对接

| # | 任务 | 后端 | 前端 | 详细文档 |
|---|------|------|------|----------|
| T23 | IP 系统 API 客户端 | ipSystemService + patentFeeController | 详情页 IP 数据卡片 + 同步按钮 | `ERP对接-年费查询接口说明.md` |
| T24 | 批量入库 + 批量删除 | inventoryBatchService + batchDelete（admin） | BatchImportDialog + 勾选删除 UI | `专利库存功能扩展记录.md` |
| T25 | 资源分类 + 利润分成 | resource_type 字段 + profit_rule JSON | 表单 + 列表 + 详情展示 | 同上 |
| T26 | 异常告警系统 | patentAnomalyService + 周日扫描 cron + alerts 表 | PatentAnomalyAlerts 页面 + 顶部 badge | 同上 |
| T27 | 部署/运维优化 | trust proxy + deploy.sh + 系统 Token | 侧边栏折叠 + 异常告警菜单 | `部署运维手册.md` |

**模块说明**：

**✅ T18 银行流水对账**：Excel 灵活列映射 + 精确/模糊匹配算法 + 三栏对比 UI + 一键创建付款。
**✅ T19 数据导出**：通用 ExportButton 组件 + 7 个后端导出接口（payments/contracts/inventory/invoices/expenses/projects/costs）+ 6 个列表页集成导出按钮（复用当前筛选条件）。
**✅ T20 历史数据迁移**：Excel 模板下载 + 上传预览校验 + 事务批量导入（合同/收付款/专利库存/成本记录）+ 重复检测 + 名称→ID 自动匹配。
**✅ T21 系统切换**：ERP 侧 SystemSwitch + Token URL 接收已就绪；主项目侧集成指南已编写（docs/T21-main-project-integration.md）。
**✅ T22 部署上线**：Nginx 配置 + 部署脚本 + 生产 .env 模板 + PM2 配置全部就绪；22.4 验证测试需部署后执行。
**🎯 Phase 4 工具+增强全部完成**！剩余任务：企微组 T9-T11/T13（需部署到公网后联调）。

**模块说明**：
**🎉 Phase 1 基础框架已全部完成**。财务核心闭环（合同 → 发票 → 收付款 → Dashboard）已打通。
**✅ T12 报销与借款**：Phase 2 的独立业务模块先行完成，不依赖企微凭证。
**✅ T14 专利库存管理**：业务特色模块完成，库龄/维持成本/调价/到期预警全部就绪。
**✅ T16 交易项目管理**：利润核算串起合同/收付款/年费；Dashboard 升级到精确毛利润。
**✅ T17 成本管理**：CostCategory CRUD + CostRecord CRUD + 同比环比 + 固定月费 cron + Dashboard 饼图接入真实数据。
**✅ T15 到期提醒（系统消息部分）**：合同 + 年费每日扫描，消息中心顶栏铃铛；企微推送待凭证就绪再接入。
**🔄 T9 企微基础集成（骨架）**：CorpID/AgentID/Secret 已配置；加解密 + API 调用 + 回调路由骨架完成；等 Token/AESKey 部署后真正联调。

---

## ✅ Phase 1 已完成功能清单

| # | 任务 | 后端交付 | 前端交付 |
|---|------|---------|---------|
| T1 | 项目骨架 | Express+Sequelize+MySQL+Redis | Vue3+Vite+Element Plus+Pinia |
| T2 | 认证权限 | JWT + 角色 + 数据隔离（attachDataFilter） | Login + 路由守卫 |
| T3 | 银行账户 | BankAccount/AccountTransfer CRUD + 余额计算 | AccountList + AccountSelect |
| T4 | 客户供应商 | Customer/Supplier CRUD + 往来账汇总 | CustomerList/SupplierList + Selects |
| T5 | 合同管理 | Contract CRUD + 状态机 + 进度计算 | ContractList/Detail + ContractSelect |
| T6 | 发票管理 | Invoice CRUD + 供应商税点自动计算 | InvoiceList 联动选择器 |
| T7 | 收付款 | Payment CRUD + 事务联动合同 paid_amount + 应收应付汇总 | PaymentList（tabs + 6维筛选） |
| T8 | Dashboard | 6 个聚合接口（overview/accounts/trend/cost-breakdown/pending/aging） | 8 指标卡 + 趋势图 + 饼图 + 账户表 |

**基础设施**：Joi 校验中间件、操作日志中间件、数据隔离中间件、Sidebar + SystemSwitch 布局、全量路由占位。

---

## ✅ Phase 2 已完成功能清单（进行中）

| # | 任务 | 后端交付 | 前端交付 |
|---|------|---------|---------|
| T12 | 报销与借款 | Expense/Loan/LoanRepayment 模型 + CRUD + 还款事务联动 + 报销三维统计（类别/人员/月度）+ 借款状态自动维护（unpaid/partial/paid）+ 账户余额扩展（expenses confirmed / loans / loan_repayments 纳入 calculateBalance 和 getFlow） | ExpenseList（统计卡片+Tab 待确认+CRUD 弹窗）+ LoanList（汇总卡片+还款弹窗+还款明细抽屉+级联删除提示） |

**T12 关键设计点**：
- 单据独立性：报销/借款不写 payments 表，避免双重计账；通过 accountService 实时聚合
- 事务保护：新增/删除还款 → 事务内重算 `Loan.repaid_amount` 和 `status`，防止丢失更新
- 幂等字段：expenses.sp_no / loans.sp_no 预留企微审批同步，创建时做唯一性校验
- 数据隔离：agent 角色仅可见 created_by=自己的记录（两层保护：中间件 + service 兜底）
- 容差处理：还款金额上限校验用 0.01 容差避免浮点误差

---

## ✅ Phase 3 已完成功能清单（进行中）

| # | 任务 | 后端交付 | 前端交付 |
|---|------|---------|---------|
| T14 | 专利库存管理 | PatentInventory/PatentAnnualFee/PatentPriceHistory 模型 + 完整 CRUD + 入库/调价/批量调价/状态变更 + 年费事务联动（重算 total_maintain_cost + next_fee_deadline）+ 库存总览（6 项汇总：总数/在库/现价/预估利润/维持成本/平均库龄）+ 即将到期查询（DATEDIFF） | InventoryList（6 指标卡 + 库龄/领域/排序筛选 + 批量调价弹窗 + 到期预警抽屉）+ InventoryDetail（基本信息 + 财务摘要卡 + 年费表格 + 调价历史时间线） |
| T16 | 交易项目管理 | Project 模型（含 5 个聚合冗余字段）+ CRUD + refreshAggregates（从 contracts/payments/patent_annual_fees 聚合）+ getProfitDetail（Sankey 数据源）+ getProfitSummary（Dashboard 升级）+ 状态自动流转（所有销售合同 completed → 项目 completed）+ 删除仅解除关联保留单据 | ProjectList（6 指标卡 + 多维筛选 + 刷新/状态/CRUD）+ ProjectDetail（基本信息卡 + 财务摘要 + 资金流向 Sankey 图 + 5 Tab 关联明细）+ ProjectSelect 业务选择器 + Dashboard 接入精确毛利润（替换现金净额粗估）|
| T17 | 成本管理 | CostCategory 模型 + 类别 CRUD（树形/admin 限定）+ CostRecord CRUD + 月度/大类/细类汇总 + 同比环比（月环比/年同比）+ 固定月费自动生成（recurringCostJob cron 每月 1 日 00:05）+ Payment 自动联动（费用类 confirmed 同步写 cost_record）+ Dashboard getCostBreakdown 数据源改为 cost_records | CostList（同比环比卡片 + 12 月堆叠趋势图 + 大类饼图 + CRUD 弹窗 + 类别管理抽屉 + 固定月费手动触发按钮 + cascader 类别选择器）+ CostTrendChart（ECharts 堆叠柱图）+ 常量 COST_CATEGORY_TYPE_MAP |
| T15 | 到期提醒（系统消息）| Notification 模型（含 dedupe_key 幂等字段）+ notificationService（upsert/broadcast/getList/markRead/cleanup）+ contractReminderJob（每日 09:00 扫描 30 天内到期合同，7 天内 danger / 30 天内 warning）+ feeReminderJob（每日 09:00 复用 inventoryService.getExpiring 扫描 60/30/7 天内年费到期，按剩余天数分级）| NotificationBell（顶栏铃铛 + 未读 badge + 60 秒轮询 + 抽屉展示消息列表）+ 类型筛选 + 仅未读 + 批量已读 + 点击自动已读+跳转 link |

**T14 关键设计点**：
- 派生字段动态计算：库龄（stock_in_date → NOW）、利润预估（current_price - purchase_price - maintain_cost）不入库，避免数据冗余不一致
- 调价审计：每次调价（单个/批量）都事务内写一条 `price_history`，永不直接改 history；需要修正通过反向调价留痕
- 汇总冗余：`total_maintain_cost` 和 `next_fee_deadline` 在 annual_fee 新增/删除时事务内重算（SUM + MAX）
- 批量调价安全：不指定任何筛选时默认只影响 `status='in_stock'`，二次确认后才执行
- 调价方式：fixed（覆盖价）/ percent（百分比，如 +10% 或 -5%）
- 到期预警着色：≤7 天红色、≤30 天橙色，前端复用服务端 `days_left` 字段

**T16 关键设计点**：
- 聚合冗余：sale/purchase/tax/maintain/gross_profit 5 个字段由 refreshAggregates 写入，避免每次查询跑多表 JOIN；列表页直接用
- 聚合公式：`tax_cost = sum(purchase.amount × supplier.tax_rate / 100)`，`maintain_cost = sum(annual_fees WHERE inventory.project_id=X)`
- 刷新时机：创建项目时立即聚合；手动 `POST /:id/refresh`；`getProfitDetail` 接口自动先刷新再返回
- 状态自动流转：仅在 `active` 状态且有销售合同且全部 completed 时自动转 completed，避免把手动 cancelled 的项目误转回去
- Sankey 数据格式：后端返回 `{flows: [{from, to, value}]}`，前端 ECharts Sankey 直接消费；利润为负时节点自动切换成"亏损"
- 删除策略：仅解除关联（contracts/payments/inventories 的 project_id 置 null），原始单据保留，避免财务数据丢失
- 数据隔离：agent 可见 `created_by=自己 OR owner_id=自己`（两种业务场景：我创建的 / 分配给我的）
- Dashboard 升级：getOverview 接入 projectService.getProfitSummary，返回 `gross_profit`（全部）+ `completed_profit`（已兑现）+ 项目计数

**T17 关键设计点**：
- Payment 联动：paymentService.create/update/confirm/delete 内部懒加载 costService 调用 syncFromPayment/removeFromPayment，避免循环依赖；费用类 confirmed payment 自动同步一条 cost_record，编辑 / 改为 pending / 删除时同步处理 cost_record
- 单一数据源：费用类 payment 自动写 cost_record 后，Dashboard 的 getCostBreakdown 数据源改为 cost_records（更完整，含 cron 生成的固定月费和手动录入）
- 固定月费自动生成：jobs/recurringCostJob.js 通过 cron `5 0 1 * *` 每月 1 日 00:05 触发，规则为"取每个 (category_id, user_id) 组合最新 is_recurring=1 记录作为模板，目标月份若无同组合记录则复制一条"，幂等；管理员可手动触发 POST /costs/recurring/generate
- 类别删除安全：有 cost_records / payments 引用或有子类别时拒绝删除，建议改为停用
- 同比环比：SQL 直接按 cost_month 分组聚合，prev_month / prev_year 由 JavaScript 计算月份字符串；delta_pct 在 base=0 时返回 null 避免除零
- 前端 cascader：自动从 categoryTree 转换为两级级联数据，编辑记录时反向查找路径定位选中项

**T15 关键设计点**：
- 幂等去重：`(user_id, source_type, source_id, dedupe_key)` 组合每日只生成一条未读消息；dedupe_key 格式 `{阈值}d_{YYYY-MM-DD}`（如 `30d_2026-06-10`），避免 cron 每日运行产生重复
- 消息层解耦：业务层（定时任务）调 notificationService.upsert 写消息；前端独立消费，企微推送（T11）日后会在同一入口追加 `wechatMessageService.send`，两端数据一致
- 等级分层：合同 ≤7 天 danger / ≤30 天 warning；年费 ≤7/≤30/≤60 danger/warning/info，高紧急度用红色 badge
- 数据隔离：用户只看 user_id=自己；admin 额外看 user_id=NULL 的广播消息（两路 OR 条件）
- 轮询策略：NotificationBell 60 秒轮询未读数，避免 WebSocket 基建复杂度；打开抽屉时重新拉最新列表
- 定时任务注册：jobs/index.js 三个 cron 全部就位 —— 合同提醒 09:00 / 年费提醒 09:00 / 固定月费 每月 1 日 00:05

---

## ✅ Phase 4 已完成功能清单（进行中）

| # | 任务 | 后端交付 | 前端交付 |
|---|------|---------|---------|
| T18 | 银行流水对账 | BankStatement 模型 + 灵活 Excel 列映射解析（exceljs） + 精确/模糊匹配算法（金额 100% + 日期容差 + 摘要 bigram 相似度）+ 三栏对账结果 + 从流水一键创建付款（复用 paymentService，自动联动合同/cost_record）+ 手动匹配/解除/忽略 + 对账历史 + classify_rules 关键词归类建议 | ReconciliationPage（3 Tab：新建/结果/历史）+ 拖拽上传 + 列映射向导（含正负合并 / 收支分列两种银行格式） + 三栏可视化（matched/unmatched/extra）+ 未匹配一键创建付款弹窗 + 已匹配一键解除 + 批次删除 |
| T19 | 数据导出 | exportService（7 模块导出：payments/contracts/inventory/invoices/expenses/projects/costs）+ exceljs 生成 .xlsx（含表头格式化、列宽自适应）+ exportController + routes/export.js（7 GET 路由）+ utils/excelHelper.js（sendExcel 响应封装）+ 操作日志记录导出行为 | ExportButton.vue 通用组件（path + params + 二次确认 + loading + Content-Disposition 文件名解析）+ 6 个列表页集成（PaymentList/ContractList/InventoryList/ExpenseList/ProjectList/CostList）+ exportParams 计算属性复用当前筛选条件 |
| T20 | 历史数据迁移 | importService（模板生成 + 解析校验 + 事务批量写入）+ importController（3 接口：template/validate/execute）+ routes/import.js（multer 内存存储 + admin 限定）+ 4 种导入类型（contracts/payments/inventory/costs）+ 重复检测（contract_no/patent_no）+ 名称→ID 自动匹配（客户/供应商/账户/类别） | ImportPage.vue（4 步骤条：选择类型→上传文件→预览校验→导入结果）+ 模板下载 + 拖拽上传 + 校验结果分 Tab 展示（通过/失败）+ 二次确认 + 导入明细表格 |
| T21 | 系统切换 | ERP 侧：SystemSwitch.vue（跳转主项目 + 携带 token）+ 路由守卫 token 接收 + .env 配置 | 主项目侧：集成指南文档（docs/T21-main-project-integration.md）含代码示例 + SSO 流程说明 |
| T22 | 部署上线 | deploy/nginx.conf（SSL + 反向代理 + Gzip + 静态缓存）+ deploy/deploy.sh（自动化部署脚本）+ .env.production（生产环境变量模板）+ ecosystem.config.js（PM2 进程管理） | 部署文档 + 首次初始化流程 + 企微回调 URL 配置说明 |

**T18 关键设计点**：
- Excel 列映射可配置：前端让用户指定"交易日期在哪列、金额在哪列"等，支持国内各种银行的导出格式，不用写死解析规则
- 算法两档：±1 天精确（满分 100）；±3 天模糊（按 bigram 摘要相似度打分），分数 < 60 不匹配
- 候选去重：已被其他 statement 匹配的 payment 自动排除，避免一对多
- 原单据保留：删除批次/解除匹配时原 payments 保留（单据独立），避免误删财务记录
- 一键创建付款复用 paymentService.create，自动触发合同 paid_amount 和 cost_record 联动
- classify_rules 提供建议类别（T13 未完成时兜底）；后续 T13 上线可替换为更复杂的匹配引擎
- multer 内存存储，10MB 限制；事务整批写入，出错回滚

---

## 🎁 T16 附带升级

**Dashboard 精确毛利润**（替换 T8 的现金净额粗估）
- 后端 `dashboardService.getOverview` 改用 `projectService.getProfitSummary({}).all.gross_profit`
- 额外返回 `completed_profit / project_count / completed_count`
- 前端 Dashboard 的"毛利润（粗估）"卡片改为"毛利润"，副标题显示"已完成项目 ¥x · y 个项目"
- 技术债"精确利润替换现金净额"已勾销

---

## 🎯 开发策略（单会话接管）

### 指导原则
1. **价值导向**：优先保障可独立交付、立即可用的功能
2. **依赖解耦**：企微集成需真实凭证，可以放到后期；先把不依赖外部的模块做完
3. **渐进式落地**：每个 Phase 结束都要是一个可用的里程碑版本
4. **代码质量**：所有核心文件补充详细中文注释，关键业务逻辑写清设计意图

### 调整后的 Phase 路线图

**原顺序**：Phase 2（企微）→ Phase 3（库存/成本）→ Phase 4（工具）

**调整为**：
- **P1（新）：独立业务模块** — T12 报销借款 + T14 专利库存 + T16 交易项目 + T17 成本管理
- **P2（新）：分析增强**     — T15 提醒任务（先跳过企微推送部分）+ Dashboard 升级
- **P3（新）：企微集成**     — T9 基础 + T10 审批同步 + T11 消息推送 + T13 自动归类
- **P4（新）：工具+上线**    — T18 对账 + T19 导出 + T20 迁移 + T21 系统切换 + T22 部署

**为什么这么调整**：
- T12/T14/T16/T17 可以**独立开发、独立验收**，不依赖企微凭证
- T14（库存）做完后 T16（交易项目）的利润计算才能落地，T17（成本）再给 Dashboard 的净利润供数
- 企微集成（T9-T11）需要真实配置才能联调，但可以**先落代码骨架 + Mock 测试**
- 报销借款（T12）从业务上也不强依赖企微（虽然最终审批由企微走），手工录入也能用

---

## 📋 下一步详细计划

### 🚀 第一阶段（当前）：核心业务扩充（预计 1.5 周）

按开发顺序排列，每个任务独立可交付：

#### ▶ ~~**T12 报销与借款管理**~~（✅ 2026-05-12 完成）
- 目的：完善财务闭环的"费用"支线，无外部依赖
- 后端交付：
  - ✅ `models/Expense.js`、`models/Loan.js`、`models/LoanRepayment.js`
  - ✅ `services/expenseService.js`（CRUD + 类别/人员/月度统计）
  - ✅ `services/loanService.js`（CRUD + 事务化还款 + 状态自动维护）
  - ✅ `accountService.calculateBalance` 和 `getFlow` 扩展，纳入 expenses/loans/repayments
  - ✅ `routes/expenses.js`、`routes/loans.js`（含 /summary/* 子路由）
  - ✅ Joi validators，operationLog 中间件接入
- 前端交付：
  - ✅ `views/expense/ExpenseList.vue`（统计卡片 + Tab 待确认 + CRUD）
  - ✅ `views/loan/LoanList.vue`（汇总卡片 + 还款弹窗 + 还款明细抽屉）
  - ✅ `api/expense.js`、`api/loan.js`
  - ✅ `constants.js` 的 `LOAN_STATUS_MAP` 对齐后端枚举（unpaid/partial/paid）
- 数据库：✅ expenses / loans / loan_repayments 表追加到 `init-database.sql`
- 已知限制（登记到技术债）：
  - 报销人、借款人当前用数字 ID 输入，等 T21 主项目用户接口就绪后改下拉
  - 成本类别当前用数字 ID 输入，等 T17 完成后改树形选择器
  - 账户余额计算 QPS 升高后可能需要加 Redis 缓存（T18 前评估）

#### ▶ ~~**T14 专利库存管理**~~（✅ 2026-05-12 完成）
- 目的：业务特色模块，囤积专利的完整生命周期管理
- 后端交付：
  - ✅ `models/PatentInventory.js / PatentAnnualFee.js / PatentPriceHistory.js`
  - ✅ `services/inventoryService.js`（CRUD / 调价 / 批量调价 / 年费 / 总览 / 到期查询）
  - ✅ `controllers/inventoryController.js`、`routes/inventory.js`
  - ✅ `validators/inventory.js`（8 个 schema）
  - ✅ 关联关系：PatentInventory ↔ Supplier/Contract，AnnualFee ↔ Inventory/Payment
  - ✅ 入库、库龄（DATEDIFF）、维持成本汇总、调价 + 批量调价
  - ✅ 利润预估（current_price - purchase_price - total_maintain_cost）
  - ✅ 即将到期查询（`/inventory/expiring?days=60/30/7`）
- 前端交付：
  - ✅ `views/inventory/InventoryList.vue`（6 指标卡 + 库龄/领域/排序筛选 + 调价弹窗 + 批量调价弹窗 + 到期预警抽屉）
  - ✅ `views/inventory/InventoryDetail.vue`（基本信息 + 财务摘要 + 年费表格 + 调价历史时间线）
  - ✅ `api/inventory.js`（12 个接口封装）
  - ✅ `constants.js` 的 `INVENTORY_STATUS_MAP`（对齐后端 in_stock/sold/abandoned/transferring）和 `FEE_TYPE_MAP`
- 数据库：✅ patent_inventory / patent_annual_fees / patent_price_history 表追加到 `init-database.sql`
- 已知限制：
  - T15 年费到期提醒（定时任务 + 企微推送）还没做，当前只能手工看抽屉
  - batchChangePrice 没有做 row-level lock，高并发批量同时操作可能丢失更新（实际业务极低频，登记技术债）

#### ▶ ~~**T16 交易项目管理**~~（✅ 2026-05-12 完成）
- 目的：把"专利囤积-销售"串成一个可核算利润的项目
- 后端交付：
  - ✅ `models/Project.js`（含 5 个聚合冗余字段）
  - ✅ `services/projectService.js`（CRUD + refreshAggregates + getProfitDetail + getProfitSummary + 状态流转）
  - ✅ `controllers/projectController.js`、`routes/projects.js`（9 路由）
  - ✅ `validators/project.js`
  - ✅ 模型关联：Project ↔ Customer/Supplier/Contract/Payment/PatentInventory
  - ✅ 利润计算：sale - purchase - tax - maintain（事务化聚合）
  - ✅ 状态自动判断：所有销售合同 completed → 项目 completed
  - ✅ 数据隔离：agent 可见 created_by=自己 OR owner_id=自己
- 前端交付：
  - ✅ `views/project/ProjectList.vue`（6 指标卡 + 多维筛选 + 刷新/状态/CRUD）
  - ✅ `views/project/ProjectDetail.vue`（基本信息 + 财务摘要 + Sankey + 5 Tab 关联明细）
  - ✅ `views/project/ProfitSankey.vue`（ECharts Sankey 独立组件）
  - ✅ `components/business/ProjectSelect.vue`（懒加载 + 远程搜索，支持 status 过滤）
  - ✅ `api/project.js`（9 接口）
  - ✅ `constants.js` 的 `PROJECT_STATUS_MAP`
- Dashboard 升级：
  - ✅ `dashboardService.getOverview` 接入 `projectService.getProfitSummary`，返回精确毛利润 + 已完成利润 + 项目计数
  - ✅ 前端 Dashboard"毛利润"卡片副标题显示"已完成项目 ¥x · y 个项目"
  - ✅ 技术债「精确利润替换现金净额」已勾销
- 已知限制：
  - Contract/Payment/AnnualFee 的 CRUD 目前不主动触发项目刷新（避免业务层依赖倒转），需用户手动点"刷新"或打开详情页自动刷新
  - 后续可考虑在 Contract/Payment 的 after-save hook 里异步触发刷新（登记技术债）

#### ▶ ~~**T17 成本管理**~~（✅ 2026-05-12 完成）
- 目的：公司层面的成本录入与分析，支撑净利润计算
- 后端交付：
  - ✅ `models/CostCategory.js`（字典表，含自关联 parent/children）
  - ✅ `services/costService.js`（14 方法：类别 CRUD + 记录 CRUD + 4 种汇总 + Payment 联动 + 固定月费生成）
  - ✅ `controllers/costController.js`、`routes/costs.js`（14 路由）
  - ✅ `validators/cost.js`（10 schema）
  - ✅ `jobs/recurringCostJob.js` + jobs/index.js cron 注册（每月 1 日 00:05）
  - ✅ `services/paymentService.js` create/update/confirm/delete 内嵌 cost 联动（懒加载避免循环依赖）
  - ✅ 模型关联：CostRecord ↔ CostCategory，Payment ↔ CostCategory，CostCategory 自关联
  - ✅ 按月/季/年汇总 API + 同比环比（月环比/年同比）
- 前端交付：
  - ✅ `views/cost/CostList.vue`（同比环比卡片 + CRUD + 类别管理抽屉 + 固定月费手动触发）
  - ✅ `views/cost/CostTrendChart.vue`（ECharts 堆叠柱图，按大类分层）
  - ✅ `api/cost.js`（14 接口）
  - ✅ `constants.js` 的 `COST_CATEGORY_TYPE_MAP`（5 大类含颜色映射）
  - ✅ 复用 `CostPieChart` 展示大类占比
- Dashboard 升级：
  - ✅ `dashboardService.getCostBreakdown` 数据源由 `payments` 改为 `cost_records`（接入 cron 生成的固定月费和手动录入的成本）
  - ✅ 技术债「成本类别选择器」已勾销（cascader 就位）
- 已知限制：
  - 净利润 = 毛利润 - 人力 - 运营 - 营销 的前端展示还没做（需要再加一个指标卡，登记技术债）
  - Payment 编辑时切换 cost_category_id 会导致旧 cost_record 被改为新类别（预期行为），但若原 payment_id 无 cost_category_id（历史数据），同步时会跳过，需留意

### 🚀 第二阶段：分析增强（预计 3-5 天）

#### ▶ **T15 合同到期提醒**（预计 1-2 天）
- 先做"合同到期"那一半，不依赖企微
- `jobs/contractReminderJob.js` 每日 9:00 查询 30 天内到期合同
- 前期用日志 + 系统消息（系统内置消息中心），Phase 3 再接企微推送

#### ▶ **Dashboard 深化**（预计 2-3 天）
- 接入 T14/T16/T17 的数据
- 新增图表：应收账龄分布图、Top 客户/供应商、项目利润排行
- 添加 Redis 缓存（TTL 5 分钟）

### 🚀 第三阶段：企微集成（预计 1.5 周）

等用户准备好企业微信凭证后启动。可用 Mock 事件先跑通代码骨架：

- **T9 基础集成**：加解密、回调、access_token 管理、用户绑定（主项目 users 加字段）
- **T10 审批同步**：模板映射配置、同步服务、幂等去重、失败重试
- **T11 消息推送**：文本卡片消息
- **T13 自动归类**：基于 `classify_rules`（已预置 20+ 关键词），集成到审批同步

### 🚀 第四阶段：工具 + 上线（预计 1.5 周）

- **T18 银行流水对账**：Excel 导入 + 精确匹配 + 模糊匹配 + 结果三栏对比
- **T19 数据导出**：通用 ExportButton + 各模块导出（exceljs）
- **T20 历史数据迁移**：Excel 模板 + 预览校验 + 事务批量写入
- **T21 系统切换**：SystemSwitch 已写，这里补主项目侧入口
- **T22 部署上线**：Nginx + PM2 + 生产 .env + 数据初始化 + 端到端验证

---

## 🧪 验收检查清单（每个任务完成后自检）

- [ ] 后端模块加载无报错（`node -e "require('./src/models'); require('./src/routes')"`）
- [ ] 前端构建通过（`npm run build`）
- [ ] 所有新文件有文档头块注释 + 关键函数 JSDoc
- [ ] 新增路由已挂载到 `routes/index.js`
- [ ] 新增模型已注册到 `models/index.js`（含关联关系）
- [ ] 新增表结构已同步到 `scripts/init-database.sql`
- [ ] tasks.md 状态更新
- [ ] PROGRESS.md 完成清单更新

---

## 🔍 已知技术债 / 待优化项

Phase 1-3 累积的优化项：

| 优先级 | 项目 | 所在位置 | 处理时机 |
|--------|------|---------|---------|
| 高 | Dashboard Redis 缓存 | dashboardService | 第二阶段 Dashboard 深化时 |
| 中 | 报销人/借款人/项目负责人下拉 | ExpenseList/LoanList/ProjectList（当前用 ID 输入） | T21 主项目用户接口就绪后 |
| 中 | agent Dashboard 数据隔离 | dashboardService | 第二阶段 |
| 中 | PaymentService 并发安全 | _updateContractPaidAmount | T18 前改原子 SQL |
| 中 | LoanService 并发安全 | _refreshLoanAggregates（两步 select→update） | T18 前评估 |
| 中 | InventoryService 并发安全 | changePrice / batchChangePrice / _refreshMaintainAggregates | T18 前评估 |
| 中 | ProjectService 自动刷新 | Contract/Payment/AnnualFee CRUD 不联动 Project 刷新 | T18 前接入 after-save hook |
| 中 | 账户余额聚合性能 | accountService.calculateBalance（多条 SUM） | T18 前考虑 Redis 缓存 |
| 中 | Dashboard 净利润指标卡 | Dashboard.vue（毛利润 - 成本 = 净利润） | 第二阶段 Dashboard 深化 |
| 低 | 前端 bundle 拆分 | vite.config.js（首屏 1.2MB） | 上线前优化 |
| 低 | 合同附件上传（COS） | Contract.attachment_url | T19/T20 |
| 低 | 合同删除级联分析 | contractService | T18 前处理 |
| 低 | Dashboard overview 纳入 expenses/loans | dashboardService | 第二阶段 Dashboard 深化 |
| 低 | 库存删除时关联检查 | inventoryService.delete（Payment/Project 外键悬空） | T18 前处理 |
| 低 | 成本类别选择器用户确认 | CostList.vue cascader 在 parent 无 children 时禁用状态 | 后续 UX 优化 |

已勾销：
- ~~精确利润替换现金净额~~（✅ T16 完成）
- ~~成本类别选择器（树形）~~（✅ T17 cascader 就位）
- ~~Dashboard overview cost-breakdown 接入真实数据~~（✅ T17 完成）

---

## 🏗️ 技术栈

| 层级 | 技术 | 状态 |
|------|------|------|
| 前端 | Vue 3 + Vite + Element Plus + Pinia + ECharts | ✅ |
| 后端 | Express + Sequelize + MySQL + Redis | ✅ |
| 校验 | Joi（middlewares/validate + validators/*） | ✅ |
| 认证 | JWT（共享主项目 Secret） | ✅ |
| 权限 | 角色 + 数据隔离（attachDataFilter） | ✅ |
| 部署 | PM2 + Nginx (erp.iptt.top) | ⏳ T22 |
| 集成 | 企业微信审批回调 + 消息推送 | ⏳ Phase 3 |

---

## 📁 当前项目结构

```
ERP/
├── backend/
│   ├── src/
│   │   ├── app.js                    ✅
│   │   ├── config/                   ✅ database, mainDatabase, redis, wechat
│   │   ├── controllers/              ✅ auth, account, customer, supplier,
│   │   │                                contract, invoice, payment, dashboard
│   │   ├── jobs/                     ✅ index（定时任务骨架）
│   │   ├── middlewares/              ✅ auth, permission（attachDataFilter）,
│   │   │                                errorHandler, operationLog, validate
│   │   ├── models/                   ✅ 9 模型 + index.js 关联中心
│   │   │                                BankAccount/AccountTransfer/Customer/Supplier/
│   │   │                                Contract/Invoice/Payment/CostRecord/MainUser
│   │   ├── routes/                   ✅ 9 路由
│   │   ├── services/                 ✅ 8 service（CostService 待 T17 补）
│   │   ├── utils/                    ✅ logger, errors, pagination
│   │   └── validators/               ✅ 5 validators
│   └── scripts/init-database.sql     ✅ 8 张表（含预置数据）
├── frontend/
│   └── src/
│       ├── api/                      ✅ 9 个 API 模块
│       ├── components/
│       │   ├── business/             ✅ 4 Select 组件
│       │   ├── dashboard/            ✅ StatCard, TrendChart, CostPieChart
│       │   └── layout/               ✅ Sidebar, SystemSwitch
│       ├── layout/                   ✅ MainLayout
│       ├── router/                   ✅ 全量路由（Phase 2/3/4 占位已就绪）
│       ├── stores/                   ✅ user, app, dashboard
│       ├── utils/                    ✅ format, constants, permission
│       └── views/                    ✅ 已实现：Login, Dashboard, NotFound,
│                                        account, customer, supplier, contract,
│                                        invoice, payment
│                                     ⏳ 占位待实现：expense, loan, cost, inventory,
│                                        project, reconciliation, import, system/*
└── docs/
    ├── requirements.md               ✅
    └── PROGRESS.md                   ✅ (本文档)
```

---

## 📅 更新后的时间线（单会话节奏）

```
✅ Week 1-2:  T1-T8（Phase 1 基础框架 + 核心数据）
⏳ Week 3-4:  T12 报销借款 → T14 专利库存 → T16 交易项目 → T17 成本管理
   Week 5:    T15 合同到期提醒 + Dashboard 深化（接入精确利润/成本）
   Week 6-7:  T9 企微基础 → T10 审批同步 → T11 消息推送 → T13 自动归类
   Week 8-9:  T18 流水对账 → T19 导出 → T20 迁移 → T21 系统切换 → T22 部署
```

总工期：约 9 周（与原估算一致）

---

## ⚠️ 风险与注意事项

1. **企业微信凭证**：Phase 3 启动前需拿到 CorpID、Secret、Token、EncodingAESKey。
   开发阶段可 Mock 事件，端到端联调需要真实凭证。
2. **跨库写入**：patent_notice_system 只读，Phase 3 需在主项目 users 表加
   `wechat_work_userid` 字段（独立迁移脚本，需在主项目侧同步）。
3. **数据库迁移**：生产环境执行 `backend/scripts/init-database.sql`。
   每完成一个新模块，都要把对应 CREATE TABLE 追加到该脚本末尾（见验收清单）。
4. **历史数据**：~2000 条数据需 Excel 模板标准化后批量导入（T20）。
5. **前端构建**：首屏 JS ~1.2MB 有警告，上线前做代码拆分（vite manualChunks）。
6. **并发安全**：当 QPS 升高后，PaymentService 的合同 paid_amount 更新需改为原子 SQL。
