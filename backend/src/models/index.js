/**
 * ============================================================
 * 模型注册中心
 * ============================================================
 * 职责：
 *   1) 统一导入所有 Sequelize 模型
 *   2) 定义模型之间的关联关系（belongsTo / hasMany / hasOne）
 *   3) 对外导出 models 集合供业务层 require
 *
 * 【关联关系维护规则】
 *   - 新增模型时，在对应 Phase 段落补充 require + 关联关系
 *   - 关联关系集中在此处定义，避免在各 model 文件中分散（防循环依赖）
 *   - 每条关联关系需同时定义双向（belongsTo + hasMany/hasOne），保证两端都能 include
 *
 * 【跨库约束】
 *   MainUser 来自主项目 patent_notice_system，只读，不与 ERP 模型建立 Sequelize 关联
 *   （Sequelize 跨连接不支持自动关联，需要用 user_id 字段手动 JOIN 或分两次查询）
 * ============================================================
 */
const { sequelize } = require('../config/database');
const { mainSequelize } = require('../config/mainDatabase');

// ==================== ERP 业务模型 ====================
// Phase 1: 基础框架
const BankAccount = require('./BankAccount');
const AccountTransfer = require('./AccountTransfer');
const Customer = require('./Customer');
const Supplier = require('./Supplier');
const Contract = require('./Contract');
const Invoice = require('./Invoice');
const Payment = require('./Payment');
const CostRecord = require('./CostRecord');

// Phase 2: 报销借款（T12）
const Expense = require('./Expense');
const Loan = require('./Loan');
const LoanRepayment = require('./LoanRepayment');

// Phase 3: 专利库存（T14）
const PatentInventory = require('./PatentInventory');
const PatentAnnualFee = require('./PatentAnnualFee');
const PatentPriceHistory = require('./PatentPriceHistory');
const PatentAnomalyAlert = require('./PatentAnomalyAlert');

// Phase 3: 交易项目（T16）
const Project = require('./Project');

// Phase 3: 成本分类（T17）
const CostCategory = require('./CostCategory');

// Phase 3: 系统消息（T15）
const Notification = require('./Notification');

// Phase 4: 银行流水（T18）
const BankStatement = require('./BankStatement');

// Phase 5: 人事薪资（T-HR1）
const Employee = require('./Employee');

// Phase 5: 系统设置
const SystemSetting = require('./SystemSetting');

// ==================== 主项目模型（只读） ====================
const MainUser = require('./MainUser');

// ==================== 关联关系定义 ====================

// ----- 账户转账：双外键指向同一张 bank_accounts -----
AccountTransfer.belongsTo(BankAccount, { as: 'fromAccount', foreignKey: 'from_account_id' });
AccountTransfer.belongsTo(BankAccount, { as: 'toAccount', foreignKey: 'to_account_id' });

// ----- 合同 ↔ 客户/供应商 -----
Contract.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Contract.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
Customer.hasMany(Contract, { foreignKey: 'customer_id', as: 'contracts' });
Supplier.hasMany(Contract, { foreignKey: 'supplier_id', as: 'contracts' });

// ----- 发票 ↔ 合同/客户/供应商 -----
Invoice.belongsTo(Contract, { foreignKey: 'contract_id', as: 'contract' });
Invoice.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Invoice.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
Contract.hasMany(Invoice, { foreignKey: 'contract_id', as: 'invoices' });
Customer.hasMany(Invoice, { foreignKey: 'customer_id', as: 'invoices' });
Supplier.hasMany(Invoice, { foreignKey: 'supplier_id', as: 'invoices' });

// ----- 收付款 ↔ 账户/合同/客户/供应商 -----
Payment.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
Payment.belongsTo(Contract, { foreignKey: 'contract_id', as: 'contract' });
Payment.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Payment.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
BankAccount.hasMany(Payment, { foreignKey: 'account_id', as: 'payments' });
Contract.hasMany(Payment, { foreignKey: 'contract_id', as: 'payments' });
Customer.hasMany(Payment, { foreignKey: 'customer_id', as: 'payments' });
Supplier.hasMany(Payment, { foreignKey: 'supplier_id', as: 'payments' });

// ----- 成本记录 ↔ 收付款/账户 -----
// 费用类 payment 自动写入一条 cost_records（T17 完善联动写入逻辑）
CostRecord.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' });
CostRecord.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
Payment.hasOne(CostRecord, { foreignKey: 'payment_id', as: 'costRecord' });

// ----- 报销单 ↔ 账户/成本类别（T12） -----
// user_id 指向主项目 users（跨库），不在此处建 Sequelize 关联
Expense.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
BankAccount.hasMany(Expense, { foreignKey: 'account_id', as: 'expenses' });

// ----- 借款 ↔ 账户（T12） -----
Loan.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
BankAccount.hasMany(Loan, { foreignKey: 'account_id', as: 'loans' });

// ----- 还款明细 ↔ 借款/账户（T12） -----
// 一对多关联，删除借款时自动级联删除还款记录（在 service 层事务中显式处理）
LoanRepayment.belongsTo(Loan, { foreignKey: 'loan_id', as: 'loan' });
LoanRepayment.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
Loan.hasMany(LoanRepayment, { foreignKey: 'loan_id', as: 'repayments' });
BankAccount.hasMany(LoanRepayment, { foreignKey: 'account_id', as: 'loanRepayments' });

// ----- 专利库存 ↔ 供应商/合同（T14） -----
// project_id 预留给 T16 Project 模型，这里不建关联
PatentInventory.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
PatentInventory.belongsTo(Contract, { foreignKey: 'contract_id', as: 'contract' });
PatentInventory.belongsTo(Supplier, { foreignKey: 'agent_id', as: 'agent' });
Supplier.hasMany(PatentInventory, { foreignKey: 'supplier_id', as: 'inventories' });
Supplier.hasMany(PatentInventory, { foreignKey: 'agent_id', as: 'agentedInventories' });
Contract.hasMany(PatentInventory, { foreignKey: 'contract_id', as: 'inventories' });

// ----- 专利异常告警 ↔ 库存 -----
PatentAnomalyAlert.belongsTo(PatentInventory, { foreignKey: 'inventory_id', as: 'inventory' });
PatentInventory.hasMany(PatentAnomalyAlert, { foreignKey: 'inventory_id', as: 'anomalyAlerts' });

// ----- 专利年费 ↔ 库存/付款（T14） -----
PatentAnnualFee.belongsTo(PatentInventory, { foreignKey: 'inventory_id', as: 'inventory' });
PatentAnnualFee.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' });
PatentInventory.hasMany(PatentAnnualFee, { foreignKey: 'inventory_id', as: 'annualFees' });

// ----- 专利调价历史 ↔ 库存（T14） -----
PatentPriceHistory.belongsTo(PatentInventory, { foreignKey: 'inventory_id', as: 'inventory' });
PatentInventory.hasMany(PatentPriceHistory, { foreignKey: 'inventory_id', as: 'priceHistory' });

// ----- 交易项目 ↔ 客户/供应商/合同/收付款/库存（T16） -----
Project.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Project.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
Customer.hasMany(Project, { foreignKey: 'customer_id', as: 'projects' });
Supplier.hasMany(Project, { foreignKey: 'supplier_id', as: 'projects' });

// Contract / Payment / PatentInventory 的 project_id 字段已在各自模型声明，
// 这里建立反向关联便于聚合查询
Contract.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Project.hasMany(Contract, { foreignKey: 'project_id', as: 'contracts' });

Payment.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Project.hasMany(Payment, { foreignKey: 'project_id', as: 'payments' });

PatentInventory.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Project.hasMany(PatentInventory, { foreignKey: 'project_id', as: 'inventories' });

// ----- 成本分类 ↔ 成本记录/收付款（T17） -----
// CostCategory 是字典表，Payment/CostRecord 的 cost_category_id/category_id 指向它
CostRecord.belongsTo(CostCategory, { foreignKey: 'category_id', as: 'category' });
CostCategory.hasMany(CostRecord, { foreignKey: 'category_id', as: 'records' });

Payment.belongsTo(CostCategory, { foreignKey: 'cost_category_id', as: 'costCategory' });
CostCategory.hasMany(Payment, { foreignKey: 'cost_category_id', as: 'payments' });

// 父子层级（自关联）
CostCategory.belongsTo(CostCategory, { foreignKey: 'parent_id', as: 'parent' });
CostCategory.hasMany(CostCategory, { foreignKey: 'parent_id', as: 'children' });

// ----- 银行流水 ↔ 账户/收付款（T18） -----
BankStatement.belongsTo(BankAccount, { foreignKey: 'account_id', as: 'account' });
BankStatement.belongsTo(Payment, { foreignKey: 'matched_payment_id', as: 'matchedPayment' });
BankAccount.hasMany(BankStatement, { foreignKey: 'account_id', as: 'statements' });

// ==================== 待开发模型（按 Phase 顺序添加） ====================
// Phase 2: T9-T11/T13（企微集成 + 自动归类）
//   const WechatApproval = require('./WechatApproval');
//   const WechatTemplateMapping = require('./WechatTemplateMapping');
//   const ClassifyRule = require('./ClassifyRule');

module.exports = {
  sequelize,
  mainSequelize,
  BankAccount,
  AccountTransfer,
  Customer,
  Supplier,
  Contract,
  Invoice,
  Payment,
  CostRecord,
  Expense,
  Loan,
  LoanRepayment,
  PatentInventory,
  PatentAnnualFee,
  PatentPriceHistory,
  PatentAnomalyAlert,
  Project,
  CostCategory,
  Notification,
  BankStatement,
  Employee,
  SystemSetting,
  MainUser,
};
