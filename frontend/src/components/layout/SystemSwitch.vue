<template>
  <el-tooltip v-if="mainSystemUrl" content="切换到官文通知系统" placement="bottom">
    <el-button
      class="system-switch-btn"
      text
      type="primary"
      aria-label="在新窗口打开官文通知系统"
      @click="switchToMainSystem"
    >
      <el-icon><Switch /></el-icon>
      <span class="switch-label">官文系统</span>
    </el-button>
  </el-tooltip>
</template>

<script setup>
import { Switch } from '@element-plus/icons-vue'
import { normalizeExternalHttpUrl } from '@/utils/externalNavigation'

const MAIN_SYSTEM_URL = normalizeExternalHttpUrl(
  import.meta.env.VITE_MAIN_SYSTEM_URL,
  'https://iptt.top'
)
const mainSystemUrl = MAIN_SYSTEM_URL

function switchToMainSystem() {
  const opened = window.open(MAIN_SYSTEM_URL, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
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
