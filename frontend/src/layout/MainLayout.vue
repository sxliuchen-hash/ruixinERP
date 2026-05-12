<template>
  <el-container class="main-layout">
    <el-aside width="220px" class="aside">
      <Sidebar />
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
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
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useUserStore } from '@/stores/user'
import Sidebar from '@/components/layout/Sidebar.vue'
import SystemSwitch from '@/components/layout/SystemSwitch.vue'
import NotificationBell from '@/components/layout/NotificationBell.vue'

const userStore = useUserStore()

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
  overflow-y: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e6e6e6;
  background: #fff;
}

.header-left {
  display: flex;
  align-items: center;
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
