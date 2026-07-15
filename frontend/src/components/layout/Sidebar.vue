<template>
  <div class="sidebar">
    <div class="logo">
      <h3 v-if="!collapsed">ERP 财务系统</h3>
      <h3 v-else style="font-size: 14px">ERP</h3>
    </div>
    <el-menu
      :default-active="activeMenu"
      router
      background-color="#304156"
      text-color="#bfcbd9"
      active-text-color="#409eff"
      :collapse="collapsed"
    >
      <el-menu-item v-if="can(PERMISSIONS.DASHBOARD_VIEW)" index="/dashboard">
        <el-icon><DataAnalysis /></el-icon>
        <span>首页概览</span>
      </el-menu-item>

      <!-- 核心业务 -->
      <el-sub-menu v-if="canAny(businessPermissions)" index="business">
        <template #title>
          <el-icon><Briefcase /></el-icon>
          <span>业务管理</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.CONTRACT_VIEW)" index="/contracts">合同管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.PAYMENT_VIEW)" index="/payments">收付款</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.INVOICE_VIEW)" index="/invoices">发票管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.PROJECT_VIEW)" index="/projects">交易项目</el-menu-item>
      </el-sub-menu>

      <!-- 人力薪资 -->
      <el-sub-menu v-if="canAny(hrPermissions)" index="hr">
        <template #title>
          <el-icon><UserFilled /></el-icon>
          <span>人力薪资</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.PERFORMANCE_VIEW)" index="/performance">业绩统计</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.PERFORMANCE_IMPORT_VIEW)" index="/performance/import">业绩上传</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.PURCHASE_COMMISSION_VIEW)" index="/performance/purchase-commission">采购提成</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.EMPLOYEE_VIEW)" index="/employees">员工档案</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.PAYROLL_VIEW)" index="/payroll">工资条</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.SALARY_RULE_VIEW)" index="/system/salary-rules">薪资规则</el-menu-item>
      </el-sub-menu>

      <!-- 费用 -->
      <el-sub-menu v-if="canAny(expensePermissions)" index="expense">
        <template #title>
          <el-icon><Wallet /></el-icon>
          <span>费用管理</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.EXPENSE_VIEW)" index="/expenses">报销管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.LOAN_VIEW)" index="/loans">借款管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.COST_VIEW)" index="/costs">成本管理</el-menu-item>
      </el-sub-menu>

      <!-- 专利库存 -->
      <el-sub-menu v-if="canAny(inventoryPermissions)" index="inventory">
        <template #title>
          <el-icon><Box /></el-icon>
          <span>专利库存</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.INVENTORY_VIEW)" index="/inventory">库存管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.INVENTORY_VIEW)" index="/inventory/sold-analytics">已售统计</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.INVENTORY_ANOMALY_VIEW)" index="/inventory/anomalies">
          <el-icon><Warning /></el-icon>
          <span>异常告警</span>
        </el-menu-item>
      </el-sub-menu>

      <!-- 基础数据 -->
      <el-sub-menu v-if="canAny(baseDataPermissions)" index="base">
        <template #title>
          <el-icon><User /></el-icon>
          <span>基础数据</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.ACCOUNT_VIEW)" index="/accounts">银行账户</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.CUSTOMER_VIEW)" index="/customers">客户管理</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.SUPPLIER_VIEW)" index="/suppliers">供应商管理</el-menu-item>
      </el-sub-menu>

      <!-- 工具 -->
      <el-sub-menu v-if="canAny(toolPermissions)" index="tools">
        <template #title>
          <el-icon><Tools /></el-icon>
          <span>工具</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.RECONCILIATION_VIEW)" index="/reconciliation">银行对账</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.IMPORT_VIEW)" index="/import">数据导入</el-menu-item>
      </el-sub-menu>

      <!-- 系统设置 -->
      <el-sub-menu v-if="canAny(systemPermissions)" index="system">
        <template #title>
          <el-icon><Setting /></el-icon>
          <span>系统设置</span>
        </template>
        <el-menu-item v-if="can(PERMISSIONS.SYSTEM_VIEW)" index="/system/templates">审批模板映射</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.CLASSIFY_RULE_VIEW)" index="/system/classify-rules">归类规则</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.WECHAT_VIEW)" index="/system/wechat-bindings">企微绑定</el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.AUDIT_VIEW)" index="/system/logs">操作日志</el-menu-item>
      </el-sub-menu>
    </el-menu>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  DataAnalysis, Briefcase, Wallet, Box, User, Tools, Setting, Warning, UserFilled
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { PERMISSIONS } from '@/constants/permissions'

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
})

const route = useRoute()
const userStore = useUserStore()

const businessPermissions = [
  PERMISSIONS.CONTRACT_VIEW,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.INVOICE_VIEW,
  PERMISSIONS.PROJECT_VIEW
]
const hrPermissions = [
  PERMISSIONS.PERFORMANCE_VIEW,
  PERMISSIONS.PERFORMANCE_IMPORT_VIEW,
  PERMISSIONS.PURCHASE_COMMISSION_VIEW,
  PERMISSIONS.EMPLOYEE_VIEW,
  PERMISSIONS.PAYROLL_VIEW,
  PERMISSIONS.SALARY_RULE_VIEW
]
const expensePermissions = [
  PERMISSIONS.EXPENSE_VIEW,
  PERMISSIONS.LOAN_VIEW,
  PERMISSIONS.COST_VIEW
]
const inventoryPermissions = [
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.INVENTORY_ANOMALY_VIEW
]
const baseDataPermissions = [
  PERMISSIONS.ACCOUNT_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.SUPPLIER_VIEW
]
const toolPermissions = [
  PERMISSIONS.RECONCILIATION_VIEW,
  PERMISSIONS.IMPORT_VIEW
]
const systemPermissions = [
  PERMISSIONS.SYSTEM_VIEW,
  PERMISSIONS.CLASSIFY_RULE_VIEW,
  PERMISSIONS.WECHAT_VIEW,
  PERMISSIONS.AUDIT_VIEW
]

const can = (permissionCode) => userStore.can(permissionCode)
const canAny = (permissionCodes) => userStore.canAny(permissionCodes)

const activeMenu = computed(() => {
  // For detail pages like /contracts/:id, highlight the parent menu
  const path = route.path
  if (path.match(/^\/contracts\/\d+/)) return '/contracts'
  if (path.match(/^\/projects\/\d+/)) return '/projects'
  if (path === '/inventory/anomalies') return '/inventory/anomalies'
  if (path === '/inventory/sold-analytics') return '/inventory/sold-analytics'
  if (path.match(/^\/inventory\/\d+/)) return '/inventory'
  if (path === '/performance/import') return '/performance/import'
  if (path === '/performance/purchase-commission') return '/performance/purchase-commission'
  return path
})
</script>

<style scoped lang="scss">
.sidebar {
  height: 100%;
  background-color: #304156;
  overflow-y: auto;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;

  h3 {
    margin: 0;
    font-size: 16px;
    white-space: nowrap;
  }
}

.el-menu {
  border-right: none;
}
</style>
