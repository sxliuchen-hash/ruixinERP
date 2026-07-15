import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { PERMISSIONS } from '@/constants/permissions'
import { resolvePostAuthRedirect } from '@/utils/authNavigation'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/sso/initiate',
    name: 'SsoInitiate',
    component: () => import('@/views/SsoInitiate.vue'),
    // public 在守卫中优先放行；permission 仅声明该认证入口属于 ERP 应用域。
    meta: { public: true, title: '正在发起 ERP 登录', permission: PERMISSIONS.APP_VIEW }
  },
  {
    path: '/sso/callback',
    name: 'SsoCallback',
    component: () => import('@/views/SsoCallback.vue'),
    meta: { public: true, title: '正在进入 ERP' }
  },
  {
    path: '/',
    name: 'Layout',
    component: () => import('@/layout/MainLayout.vue'),
    meta: { permission: PERMISSIONS.APP_VIEW },
    children: [
      // 首页
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '首页概览', permission: PERMISSIONS.DASHBOARD_VIEW }
      },
      // 核心业务 - 合同
      {
        path: 'contracts',
        name: 'Contracts',
        component: () => import('@/views/contract/ContractList.vue'),
        meta: { title: '合同管理', permission: PERMISSIONS.CONTRACT_VIEW }
      },
      {
        path: 'contracts/:id',
        name: 'ContractDetail',
        component: () => import('@/views/contract/ContractDetail.vue'),
        meta: { title: '合同详情', permission: PERMISSIONS.CONTRACT_VIEW }
      },
      // 核心业务 - 收付款
      {
        path: 'payments',
        name: 'Payments',
        component: () => import('@/views/payment/PaymentList.vue'),
        meta: { title: '收付款', permission: PERMISSIONS.PAYMENT_VIEW }
      },
      // 核心业务 - 发票
      {
        path: 'invoices',
        name: 'Invoices',
        component: () => import('@/views/invoice/InvoiceList.vue'),
        meta: { title: '发票管理', permission: PERMISSIONS.INVOICE_VIEW }
      },
      // 费用管理 - 报销
      {
        path: 'expenses',
        name: 'Expenses',
        component: () => import('@/views/expense/ExpenseList.vue'),
        meta: { title: '报销管理', permission: PERMISSIONS.EXPENSE_VIEW }
      },
      // 费用管理 - 借款
      {
        path: 'loans',
        name: 'Loans',
        component: () => import('@/views/loan/LoanList.vue'),
        meta: { title: '借款管理', permission: PERMISSIONS.LOAN_VIEW }
      },
      // 分析 - 交易项目
      {
        path: 'projects',
        name: 'Projects',
        component: () => import('@/views/project/ProjectList.vue'),
        meta: { title: '交易项目', permission: PERMISSIONS.PROJECT_VIEW }
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('@/views/project/ProjectDetail.vue'),
        meta: { title: '项目详情', permission: PERMISSIONS.PROJECT_VIEW }
      },
      // 分析 - 专利库存
      {
        path: 'inventory',
        name: 'Inventory',
        component: () => import('@/views/inventory/InventoryList.vue'),
        meta: { title: '专利库存', permission: PERMISSIONS.INVENTORY_VIEW }
      },
      {
        path: 'inventory/sold-analytics',
        name: 'SoldAnalytics',
        component: () => import('@/views/inventory/SoldAnalytics.vue'),
        meta: { title: '已售统计', permission: PERMISSIONS.INVENTORY_VIEW }
      },
      {
        path: 'inventory/anomalies',
        name: 'PatentAnomalyAlerts',
        component: () => import('@/views/inventory/PatentAnomalyAlerts.vue'),
        meta: { title: '专利异常告警', permission: PERMISSIONS.INVENTORY_ANOMALY_VIEW }
      },
      {
        path: 'inventory/:id',
        name: 'InventoryDetail',
        component: () => import('@/views/inventory/InventoryDetail.vue'),
        meta: { title: '库存详情', permission: PERMISSIONS.INVENTORY_VIEW }
      },
      // 分析 - 成本
      {
        path: 'costs',
        name: 'Costs',
        component: () => import('@/views/cost/CostList.vue'),
        meta: { title: '成本管理', permission: PERMISSIONS.COST_VIEW }
      },
      // 基础数据 - 银行账户
      {
        path: 'accounts',
        name: 'Accounts',
        component: () => import('@/views/account/AccountList.vue'),
        meta: { title: '银行账户', permission: PERMISSIONS.ACCOUNT_VIEW }
      },
      {
        path: 'customers',
        name: 'Customers',
        component: () => import('@/views/customer/CustomerList.vue'),
        meta: { title: '客户管理', permission: PERMISSIONS.CUSTOMER_VIEW }
      },
      {
        path: 'suppliers',
        name: 'Suppliers',
        component: () => import('@/views/supplier/SupplierList.vue'),
        meta: { title: '供应商管理', permission: PERMISSIONS.SUPPLIER_VIEW }
      },
      // 工具 - 银行对账
      {
        path: 'reconciliation',
        name: 'Reconciliation',
        component: () => import('@/views/reconciliation/ReconciliationPage.vue'),
        meta: { title: '银行对账', permission: PERMISSIONS.RECONCILIATION_VIEW }
      },
      // 工具 - 数据导入
      {
        path: 'import',
        name: 'Import',
        component: () => import('@/views/import/ImportPage.vue'),
        meta: { title: '数据导入', permission: PERMISSIONS.IMPORT_VIEW }
      },
      // 业绩统计看板（T-HR3）
      {
        path: 'performance',
        name: 'Performance',
        component: () => import('@/views/performance/PerformanceDashboard.vue'),
        meta: { title: '业绩统计', permission: PERMISSIONS.PERFORMANCE_VIEW, watermark: true }
      },
      // 业绩上传（需 erp.performance_import.view）
      {
        path: 'performance/import',
        name: 'PerformanceImport',
        component: () => import('@/views/performance/PerformanceImport.vue'),
        meta: { title: '业绩上传', permission: PERMISSIONS.PERFORMANCE_IMPORT_VIEW, watermark: true }
      },
      // 采购提成报表（需 erp.purchase_commission.view）
      {
        path: 'performance/purchase-commission',
        name: 'PurchaseCommission',
        component: () => import('@/views/performance/PurchaseCommission.vue'),
        meta: { title: '采购提成', permission: PERMISSIONS.PURCHASE_COMMISSION_VIEW, watermark: true }
      },
      // 薪资规则配置（T-HR2）
      {
        path: 'system/salary-rules',
        name: 'SalaryRules',
        component: () => import('@/views/system/SalaryRules.vue'),
        meta: { title: '薪资规则', permission: PERMISSIONS.SALARY_RULE_VIEW, watermark: true }
      },
      // 工资条管理（T-HR4）
      {
        path: 'payroll',
        name: 'Payroll',
        component: () => import('@/views/payroll/PayrollList.vue'),
        meta: { title: '工资条', permission: PERMISSIONS.PAYROLL_VIEW, watermark: true }
      },
      // 员工档案（需 erp.employee.view）
      {
        path: 'employees',
        name: 'EmployeeList',
        component: () => import('@/views/employee/EmployeeList.vue'),
        meta: { title: '员工档案', permission: PERMISSIONS.EMPLOYEE_VIEW, watermark: true }
      },
      // 系统设置（需对应 erp.system.* 权限）
      {
        path: 'system/templates',
        name: 'TemplateMappings',
        component: () => import('@/views/system/TemplateMappings.vue'),
        meta: { title: '审批模板映射', permission: PERMISSIONS.SYSTEM_VIEW }
      },
      {
        path: 'system/classify-rules',
        name: 'ClassifyRules',
        component: () => import('@/views/system/ClassifyRules.vue'),
        meta: { title: '归类规则', permission: PERMISSIONS.CLASSIFY_RULE_VIEW }
      },
      {
        path: 'system/wechat-bindings',
        name: 'WechatBindings',
        component: () => import('@/views/system/WechatBindings.vue'),
        meta: { title: '企微绑定', permission: PERMISSIONS.WECHAT_VIEW }
      },
      {
        path: 'system/logs',
        name: 'OperationLogs',
        component: () => import('@/views/system/OperationLogs.vue'),
        meta: { title: '操作日志', permission: PERMISSIONS.AUDIT_VIEW }
      },
      {
        path: 'forbidden',
        name: 'Forbidden',
        component: () => import('@/views/Forbidden.vue'),
        meta: { title: '无权访问' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫 - 认证 + 权限检查
router.beforeEach(async (to, from, next) => {
  const userStore = useUserStore()

  // SSO callback 必须始终放行，它会先清理旧会话再开始新登录。
  if (to.path === '/sso/initiate' || to.path === '/sso/callback') return next()

  // 已登录用户不应停留在登录页；刷新资料后进入首个有权页面。
  if (to.meta.public) {
    if (to.path === '/login' && userStore.isLoggedIn) {
      try {
        if (!userStore.userInfo.id) await userStore.fetchProfile()
        if (!userStore.can(PERMISSIONS.APP_VIEW)) {
          userStore.clearAuth()
          return next({
            path: '/login',
            query: { reason: 'no_erp_access' },
            replace: true
          })
        }
        return next({ path: resolvePostAuthRedirect(userStore), replace: true })
      } catch (error) {
        const reason = error.response?.status === 403
          ? 'no_erp_access'
          : (error.response?.status === 401 ? 'session_expired' : 'session_check_failed')
        return next({ path: '/login', query: { reason }, replace: true })
      }
    }
    return next()
  }

  // 未登录 → 重定向到登录页
  if (!userStore.isLoggedIn) {
    return next({ path: '/login', query: { redirect: to.fullPath } })
  }

  // 已有 token 但未加载用户信息（页面刷新场景）→ 获取用户信息
  if (userStore.isLoggedIn && !userStore.userInfo.id) {
    try {
      await userStore.fetchProfile()
    } catch (error) {
      // fetchProfile 失败会清除 token，重定向到登录页
      const reason = error.response?.status === 403
        ? 'no_erp_access'
        : (error.response?.status === 401 ? 'session_expired' : 'session_check_failed')
      return next({
        path: '/login',
        query: { reason, redirect: to.fullPath }
      })
    }
  }

  // 所有业务页面都必须先有 ERP 应用入口权限。
  if (!userStore.can(PERMISSIONS.APP_VIEW)) {
    userStore.clearAuth()
    return next({ path: '/login', query: { reason: 'no_erp_access' } })
  }

  // 根路径按当前权限选择首个可访问页面，不再固定跳 Dashboard。
  if (to.path === '/') {
    return next({ path: resolvePostAuthRedirect(userStore), replace: true })
  }

  // 具体功能权限检查。SSO 权限缺失默认拒绝，旧登录由 Store 做角色兼容。
  if (to.meta.permission && !userStore.can(to.meta.permission)) {
    return next({ path: '/forbidden', replace: true })
  }

  next()
})

router.afterEach((to) => {
  document.title = to.meta.title
    ? `${to.meta.title} - ERP 财务管理系统`
    : 'ERP 财务管理系统'
})

export default router
