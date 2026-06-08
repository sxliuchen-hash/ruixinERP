<template>
  <el-container class="main-layout">
    <el-aside :width="sidebarCollapsed ? '64px' : '220px'" class="aside">
      <Sidebar :collapsed="sidebarCollapsed" />
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button
            link
            class="collapse-btn"
            @click="toggleSidebar"
            :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          >
            <el-icon :size="20">
              <Fold v-if="!sidebarCollapsed" />
              <Expand v-else />
            </el-icon>
          </el-button>
          <SystemSwitch />
        </div>
        <div class="header-right">
          <NotificationBell />
          <span class="username">{{ userStore.userInfo.realName || userStore.userInfo.username }}</span>
          <el-tag size="small" type="info">{{ roleLabel }}</el-tag>
          <el-button text @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main-content">
        <Watermark v-if="needWatermark">
          <router-view />
        </Watermark>
        <router-view v-else />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { Fold, Expand } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import Sidebar from '@/components/layout/Sidebar.vue'
import SystemSwitch from '@/components/layout/SystemSwitch.vue'
import NotificationBell from '@/components/layout/NotificationBell.vue'
import Watermark from '@/components/common/Watermark.vue'

const userStore = useUserStore()
const route = useRoute()

// 敏感页面（工资/业绩/薪资规则/员工档案）开启防泄露水印
const needWatermark = computed(() => route.meta && route.meta.watermark === true)

// 侧边栏折叠状态（持久化到 localStorage）
const sidebarCollapsed = ref(false)

onMounted(() => {
  const saved = localStorage.getItem('erp_sidebar_collapsed')
  if (saved === '1') {
    sidebarCollapsed.value = true
  }
})

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('erp_sidebar_collapsed', sidebarCollapsed.value ? '1' : '0')
}

const roleLabel = computed(() => {
  const map = { admin: '管理员', process: '财务', agent: '业务员' }
  return map[userStore.userInfo.role] || userStore.userInfo.role
})

function handleLogout() {
  userStore.logout()
}
</script>

<style scoped lang="scss">
.main-layout {
  height: 100vh;
}

.aside {
  background-color: #304156;
  overflow: hidden;
  transition: width 0.28s ease;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e6e6e6;
  background: #fff;
  padding: 0 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-btn {
  padding: 0 8px;
  height: 40px;

  &:hover {
    background-color: #f5f7fa;
    border-radius: 4px;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.username {
  font-size: 14px;
  color: #606266;
}

.main-content {
  background: #f0f2f5;
  min-height: calc(100vh - 60px);
}
</style>
