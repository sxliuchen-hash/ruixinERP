/**
 * 合同状态
 */
export const CONTRACT_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  TERMINATED: 'terminated'
}

export const CONTRACT_STATUS_MAP = {
  [CONTRACT_STATUS.PENDING]: { label: '待签', type: 'info' },
  [CONTRACT_STATUS.ACTIVE]: { label: '执行中', type: 'success' },
  [CONTRACT_STATUS.COMPLETED]: { label: '已完成', type: '' },
  [CONTRACT_STATUS.TERMINATED]: { label: '已终止', type: 'danger' }
}

/**
 * 合同类型
 */
export const CONTRACT_TYPE = {
  SALE: 'sale',
  PURCHASE: 'purchase'
}

export const CONTRACT_TYPE_MAP = {
  [CONTRACT_TYPE.SALE]: { label: '销售合同', type: 'success' },
  [CONTRACT_TYPE.PURCHASE]: { label: '采购合同', type: 'warning' }
}

/**
 * 确认状态
 */
export const CONFIRM_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed'
}

export const CONFIRM_STATUS_MAP = {
  [CONFIRM_STATUS.PENDING]: { label: '待确认', type: 'warning' },
  [CONFIRM_STATUS.CONFIRMED]: { label: '已确认', type: 'success' }
}

/**
 * 收支类型
 */
export const PAYMENT_TYPE = {
  INCOME: 'income',
  EXPENSE: 'expense'
}

export const PAYMENT_TYPE_MAP = {
  [PAYMENT_TYPE.INCOME]: { label: '收入', type: 'success' },
  [PAYMENT_TYPE.EXPENSE]: { label: '支出', type: 'danger' }
}

/**
 * 收支分类
 */
export const PAYMENT_CATEGORY = {
  CONTRACT_INCOME: 'contract_income',
  CONTRACT_EXPENSE: 'contract_expense',
  OFFICIAL_FEE: 'official_fee',
  ANNUAL_FEE: 'annual_fee',
  SALARY: 'salary',
  OFFICE: 'office',
  REIMBURSEMENT: 'reimbursement',
  TAX: 'tax',
  LOAN_IN: 'loan_in',
  LOAN_OUT: 'loan_out',
  TRANSFER: 'transfer',
  OTHER: 'other'
}

export const PAYMENT_CATEGORY_MAP = {
  [PAYMENT_CATEGORY.CONTRACT_INCOME]: { label: '合同收入' },
  [PAYMENT_CATEGORY.CONTRACT_EXPENSE]: { label: '合同支出' },
  [PAYMENT_CATEGORY.OFFICIAL_FEE]: { label: '官费' },
  [PAYMENT_CATEGORY.ANNUAL_FEE]: { label: '年费' },
  [PAYMENT_CATEGORY.SALARY]: { label: '工资' },
  [PAYMENT_CATEGORY.OFFICE]: { label: '办公费用' },
  [PAYMENT_CATEGORY.REIMBURSEMENT]: { label: '报销' },
  [PAYMENT_CATEGORY.TAX]: { label: '税费' },
  [PAYMENT_CATEGORY.LOAN_IN]: { label: '借入' },
  [PAYMENT_CATEGORY.LOAN_OUT]: { label: '借出' },
  [PAYMENT_CATEGORY.TRANSFER]: { label: '转账' },
  [PAYMENT_CATEGORY.OTHER]: { label: '其他' }
}

/**
 * 专利库存状态（与后端 patent_inventory.status 枚举一致）
 */
export const INVENTORY_STATUS = {
  IN_STOCK: 'in_stock',
  SOLD: 'sold',
  ABANDONED: 'abandoned',
  TRANSFERRING: 'transferring'
}

export const INVENTORY_STATUS_MAP = {
  [INVENTORY_STATUS.IN_STOCK]: { label: '在库', type: 'success' },
  [INVENTORY_STATUS.SOLD]: { label: '已售', type: '' },
  [INVENTORY_STATUS.ABANDONED]: { label: '已放弃', type: 'info' },
  [INVENTORY_STATUS.TRANSFERRING]: { label: '转让中', type: 'warning' }
}

/**
 * 专利年费类型
 */
export const FEE_TYPE = {
  ANNUAL: 'annual',
  AGENCY: 'agency',
  OTHER: 'other'
}

export const FEE_TYPE_MAP = {
  [FEE_TYPE.ANNUAL]: { label: '年费', type: 'primary' },
  [FEE_TYPE.AGENCY]: { label: '代理费', type: 'warning' },
  [FEE_TYPE.OTHER]: { label: '其他', type: 'info' }
}

/**
 * 发票状态
 */
export const INVOICE_STATUS = {
  PENDING: 'pending',
  ISSUED: 'issued',
  RECEIVED: 'received',
  CANCELLED: 'cancelled'
}

export const INVOICE_STATUS_MAP = {
  [INVOICE_STATUS.PENDING]: { label: '待开', type: 'warning' },
  [INVOICE_STATUS.ISSUED]: { label: '已开', type: 'success' },
  [INVOICE_STATUS.RECEIVED]: { label: '已收', type: '' },
  [INVOICE_STATUS.CANCELLED]: { label: '已作废', type: 'info' }
}

/**
 * 用户角色
 */
export const USER_ROLE = {
  ADMIN: 'admin',
  FINANCE: 'finance',
  MANAGER: 'manager',
  STAFF: 'staff'
}

export const USER_ROLE_MAP = {
  [USER_ROLE.ADMIN]: { label: '管理员' },
  [USER_ROLE.FINANCE]: { label: '财务' },
  [USER_ROLE.MANAGER]: { label: '经理' },
  [USER_ROLE.STAFF]: { label: '员工' }
}

/**
 * 银行账户类型
 */
export const ACCOUNT_TYPE = {
  PUBLIC: 'public',
  PRIVATE: 'private'
}

export const ACCOUNT_TYPE_MAP = {
  [ACCOUNT_TYPE.PUBLIC]: { label: '公户', type: '' },
  [ACCOUNT_TYPE.PRIVATE]: { label: '私户', type: 'warning' }
}

/**
 * 账户状态
 */
export const ACCOUNT_STATUS = {
  ENABLED: 1,
  DISABLED: 0
}

export const ACCOUNT_STATUS_MAP = {
  [ACCOUNT_STATUS.ENABLED]: { label: '启用', type: 'success' },
  [ACCOUNT_STATUS.DISABLED]: { label: '停用', type: 'info' }
}

/**
 * 收付款模式分类（业务类/费用类）
 */
export const PAYMENT_MODE_CATEGORY = {
  BUSINESS: 'business',
  FEE: 'fee'
}

export const PAYMENT_MODE_CATEGORY_MAP = {
  [PAYMENT_MODE_CATEGORY.BUSINESS]: { label: '业务类', type: 'primary' },
  [PAYMENT_MODE_CATEGORY.FEE]: { label: '费用类', type: 'warning' }
}

/**
 * 收付款方式
 */
export const PAYMENT_METHOD = {
  TRANSFER: 'transfer',
  CHECK: 'check',
  CASH: 'cash',
  OTHER: 'other'
}

export const PAYMENT_METHOD_MAP = {
  [PAYMENT_METHOD.TRANSFER]: { label: '转账' },
  [PAYMENT_METHOD.CHECK]: { label: '支票' },
  [PAYMENT_METHOD.CASH]: { label: '现金' },
  [PAYMENT_METHOD.OTHER]: { label: '其他' }
}

/**
 * 借款还款状态（与后端 loans.status 枚举一致）
 */
export const LOAN_STATUS = {
  UNPAID: 'unpaid',
  PARTIAL: 'partial',
  PAID: 'paid'
}

export const LOAN_STATUS_MAP = {
  [LOAN_STATUS.UNPAID]: { label: '未还', type: 'danger' },
  [LOAN_STATUS.PARTIAL]: { label: '部分还款', type: 'warning' },
  [LOAN_STATUS.PAID]: { label: '已还清', type: 'success' }
}

/**
 * 交易项目状态（与后端 projects.status 枚举一致）
 */
export const PROJECT_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

export const PROJECT_STATUS_MAP = {
  [PROJECT_STATUS.ACTIVE]: { label: '进行中', type: 'success' },
  [PROJECT_STATUS.COMPLETED]: { label: '已完成', type: '' },
  [PROJECT_STATUS.CANCELLED]: { label: '已取消', type: 'info' }
}

/**
 * 成本大类（与后端 cost_categories.type 枚举一致）
 */
export const COST_CATEGORY_TYPE = {
  LABOR: 'labor',
  OPERATION: 'operation',
  PATENT: 'patent',
  MARKETING: 'marketing',
  OTHER: 'other'
}

export const COST_CATEGORY_TYPE_MAP = {
  [COST_CATEGORY_TYPE.LABOR]: { label: '人力成本', color: '#409eff' },
  [COST_CATEGORY_TYPE.OPERATION]: { label: '运营成本', color: '#67c23a' },
  [COST_CATEGORY_TYPE.PATENT]: { label: '专利维持', color: '#e6a23c' },
  [COST_CATEGORY_TYPE.MARKETING]: { label: '营销成本', color: '#f56c6c' },
  [COST_CATEGORY_TYPE.OTHER]: { label: '其他', color: '#909399' }
}
