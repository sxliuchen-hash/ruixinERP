import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    name: 'Layout',
    component: () => import('@/layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      // 首页
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '首页概览' }
      },
      // 核心业务 - 合同
      {
        path: 'contracts',
        name: 'Contracts',
        component: () => import('@/views/contract/ContractList.vue'),
        meta: { title: '合同管理' }
      },
      {
        path: 'contracts/:id',
        name: 'ContractDetail',
        component: () => import('@/views/contract/ContractDetail.vue'),
        meta: { title: '合同详情' }
      },
      // 核心业务 - 收付款
      {
        path: 'payments',
        name: 'Payments',
        component: () => import('@/views/payment/PaymentList.vue'),
        meta: { title: '收付款' }
      },
      // 核心业务 - 发票
      {
        path: 'invoices',
        name: 'Invoices',
        component: () => import('@/views/invoice/InvoiceList.vue'),
        meta: { title: '发票管理' }
      },
      // 费用管理 - 报销
      {
        path: 'expenses',
        name: 'Expenses',
        component: () => import('@/views/expense/ExpenseList.vue'),
        meta: { title: '报销管理' }
      },
      // 费用管理 - 借款
      {
        path: 'loans',
        name: 'Loans',
        component: () => import('@/views/loan/LoanList.vue'),
        meta: { title: '借款管理' }
      },
      // 分析 - 交易项目
      {
        path: 'projects',
        name: 'Projects',
        component: () => import('@/views/project/ProjectList.vue'),
        meta: { title: '交易项目' }
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('@/views/project/ProjectDetail.vue'),
        meta: { title: '项目详情' }
      },
      // 分析 - 专利库存
      {
        path: 'inventory',
        name: 'Inventory',
        component: () => import('@/views/inventory/InventoryList.vue'),
        meta: { title: '专利库存' }
      },
      {
        path: 'inventory/:id',
        name: 'InventoryDetail',
        component: () => import('@/views/inventory/InventoryDetail.vue'),
        meta: { title: '库存详情' }
      },
      // 分析 - 成本
      {
        path: 'costs',
        name: 'Costs',
        component: () => import('@/views/cost/CostList.vue'),
        meta: { title: '成本管理' }
      },
      // 基础数据 - 银行账户
      {
        path: 'accounts',
        name: 'Accounts',
        component: () => import('@/views/account/AccountList.vue'),
        meta: { title: '银行账户' }
      },
      {
        path: 'customers',
        name: 'Customers',
        component: () => import('@/views/customer/CustomerList.vue'),
        meta: { title: '客户管理' }
      },
      {
        path: 'suppliers',
        name: 'Suppliers',
        component: () => import('@/views/supplier/SupplierList.vue'),
        meta: { title: '供应商管理' }
      },
      // 工具 - 银行对账
      {
        path: 'reconciliation',
        name: 'Reconciliation',
        component: () => import('@/views/reconciliation/ReconciliationPage.vue'),
        meta: { title: '银行对账' }
      },
      // 工具 - 数据导入
      {
        path: 'import',
        name: 'Import',
        component: () => import('@/views/import/ImportPage.vue'),
        meta: { title: '数据导入' }
      },
      // 员工档案（仅 admin）
      {
        path: 'employees',
        name: 'EmployeeList',
        component: () => import('@/views/employee/EmployeeList.vue'),
        meta: { title: '员工档案', role: 'admin' }
      },
      // 系统设置（仅 admin）
      {
        path: 'system/templates',
        name: 'TemplateMappings',
        component: () => import('@/views/system/TemplateMappings.vue'),
        meta: { title: '审批模板映射', role: 'admin' }
      },
      {
        path: 'system/classify-rules',
        name: 'ClassifyRules',
        component: () => import('@/views/system/ClassifyRules.vue'),
        meta: { title: '归类规则', role: 'admin' }
      },
      {
        path: 'system/wechat-bindings',
        name: 'WechatBindings',
        component: () => import('@/views/system/WechatBindings.vue'),
        meta: { title: '企微绑定', role: 'admin' }
      },
      {
        path: 'system/logs',
        name: 'OperationLogs',
        component: () => import('@/views/system/OperationLogs.vue'),
        meta: { title: '操作日志', role: 'admin' }
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

  // 检查 URL 中的 token 参数（SSO 跳转场景）
  const urlToken = to.query.token
  if (urlToken) {
    userStore.setToken(urlToken)
    // 移除 URL 中的 token 参数
    const query = { ...to.query }
    delete query.token
    return next({ path: to.path, query, replace: true })
  }

  // 公开页面直接放行
  if (to.meta.public) {
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
    } catch {
      // fetchProfile 失败会清除 token，重定向到登录页
      return next({ path: '/login', query: { redirect: to.fullPath } })
    }
  }

  // 角色权限检查（admin-only 路由）
  if (to.meta.role && userStore.userInfo.role !== to.meta.role) {
    // 无权限，重定向到首页
    return next({ path: '/dashboard' })
  }

  next()
})

export default router
