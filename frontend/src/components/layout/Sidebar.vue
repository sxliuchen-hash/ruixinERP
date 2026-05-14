<template>
  <div class="sidebar">
    <div class="logo">
      <h3>ERP 财务系统</h3>
    </div>
    <el-menu
      :default-active="activeMenu"
      router
      background-color="#304156"
      text-color="#bfcbd9"
      active-text-color="#409eff"
      :collapse="collapsed"
    >
      <el-menu-item index="/dashboard">
        <el-icon><DataAnalysis /></el-icon>
        <span>首页概览</span>
      </el-menu-item>

      <!-- 核心业务 -->
      <el-sub-menu index="business">
        <template #title>
          <el-icon><Briefcase /></el-icon>
          <span>业务管理</span>
        </template>
        <el-menu-item index="/contracts">合同管理</el-menu-item>
        <el-menu-item index="/payments">收付款</el-menu-item>
        <el-menu-item index="/invoices">发票管理</el-menu-item>
        <el-menu-item index="/projects">交易项目</el-menu-item>
        <el-menu-item index="/performance">业绩统计</el-menu-item>
      </el-sub-menu>

      <!-- 费用 -->
      <el-sub-menu index="expense">
        <template #title>
          <el-icon><Wallet /></el-icon>
          <span>费用管理</span>
        </template>
        <el-menu-item index="/expenses">报销管理</el-menu-item>
        <el-menu-item index="/loans">借款管理</el-menu-item>
        <el-menu-item index="/costs">成本管理</el-menu-item>
      </el-sub-menu>

      <!-- 专利库存 -->
      <el-menu-item index="/inventory">
        <el-icon><Box /></el-icon>
        <span>专利库存</span>
      </el-menu-item>

      <!-- 基础数据 -->
      <el-sub-menu index="base">
        <template #title>
          <el-icon><User /></el-icon>
          <span>基础数据</span>
        </template>
        <el-menu-item index="/accounts">银行账户</el-menu-item>
        <el-menu-item index="/customers">客户管理</el-menu-item>
        <el-menu-item index="/suppliers">供应商管理</el-menu-item>
      </el-sub-menu>

      <!-- 工具 -->
      <el-sub-menu index="tools">
        <template #title>
          <el-icon><Tools /></el-icon>
          <span>工具</span>
        </template>
        <el-menu-item index="/reconciliation">银行对账</el-menu-item>
        <el-menu-item index="/import">数据导入</el-menu-item>
      </el-sub-menu>

      <!-- 系统设置（仅管理员） -->
      <el-sub-menu v-if="userStore.isAdmin" index="system">
        <template #title>
          <el-icon><Setting /></el-icon>
          <span>系统设置</span>
        </template>
        <el-menu-item index="/employees">员工档案</el-menu-item>
        <el-menu-item index="/salary-rules">薪资规则</el-menu-item>
        <el-menu-item index="/system/templates">审批模板映射</el-menu-item>
        <el-menu-item index="/system/classify-rules">归类规则</el-menu-item>
        <el-menu-item index="/system/wechat-bindings">企微绑定</el-menu-item>
        <el-menu-item index="/system/logs">操作日志</el-menu-item>
      </el-sub-menu>
    </el-menu>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  DataAnalysis, Briefcase, Wallet, Box, User, Tools, Setting
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
})

const route = useRoute()
const userStore = useUserStore()

const activeMenu = computed(() => {
  // For detail pages like /contracts/:id, highlight the parent menu
  const path = route.path
  if (path.match(/^\/contracts\/\d+/)) return '/contracts'
  if (path.match(/^\/projects\/\d+/)) return '/projects'
  if (path.match(/^\/inventory\/\d+/)) return '/inventory'
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
