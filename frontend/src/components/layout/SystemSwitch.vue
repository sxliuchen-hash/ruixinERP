<template>
  <el-tooltip content="切换到官文通知系统" placement="bottom">
    <el-button
      class="system-switch-btn"
      text
      type="primary"
      @click="switchToMainSystem"
    >
      <el-icon><Switch /></el-icon>
      <span class="switch-label">官文系统</span>
    </el-button>
  </el-tooltip>
</template>

<script setup>
import { Switch } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const MAIN_SYSTEM_URL = import.meta.env.VITE_MAIN_SYSTEM_URL || 'https://iptt.top'

function switchToMainSystem() {
  // Pass token via URL for SSO between systems
  const url = `${MAIN_SYSTEM_URL}?token=${encodeURIComponent(userStore.token)}`
  window.open(url, '_blank')
}
</script>

<style scoped lang="scss">
.system-switch-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
}

.switch-label {
  margin-left: 4px;
}
</style>
