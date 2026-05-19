<!--
  批量扫描进度弹窗
  实时轮询后端进度接口，展示进度条 + 日志滚动
-->
<template>
  <el-dialog
    v-model="visible"
    title="批量更新全量信息"
    width="700px"
    :close-on-click-modal="false"
    :close-on-press-escape="progress.status !== 'running'"
    @close="handleClose"
  >
    <!-- 进度概览 -->
    <div class="progress-header">
      <el-row :gutter="16">
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">总数</div>
            <div class="stat-val">{{ progress.total }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">已完成</div>
            <div class="stat-val text-success">{{ progress.scanned }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">失败</div>
            <div class="stat-val text-danger">{{ progress.failed }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">发现异常</div>
            <div class="stat-val text-warning">{{ progress.alerts }}</div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 进度条 -->
    <el-progress
      :percentage="percentage"
      :status="progressStatus"
      :stroke-width="20"
      :text-inside="true"
      style="margin: 16px 0"
    />

    <!-- 状态提示 -->
    <div class="status-bar">
      <el-tag :type="statusTagType" size="small">{{ statusText }}</el-tag>
      <span v-if="progress.synced" class="sync-info">
        同步更新 {{ progress.synced }} 条专利信息
      </span>
    </div>

    <!-- 日志区域 -->
    <div class="log-container" ref="logContainerRef">
      <div
        v-for="(log, idx) in progress.logs"
        :key="idx"
        class="log-line"
        :class="'log-' + log.level"
      >
        <span class="log-time">{{ log.time }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
      <div v-if="!progress.logs?.length" class="log-empty">
        等待任务启动...
      </div>
    </div>

    <template #footer>
      <el-button
        v-if="progress.status === 'completed'"
        type="primary"
        @click="visible = false"
      >
        完成
      </el-button>
      <el-button
        v-else
        disabled
      >
        运行中...
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { getScanProgress, triggerAnomalyScan } from '@/api/inventory'
import { ElMessage } from 'element-plus'

const emit = defineEmits(['done'])

const visible = ref(false)
const logContainerRef = ref(null)
let pollTimer = null

const progress = ref({
  status: 'idle',
  total: 0,
  scanned: 0,
  failed: 0,
  alerts: 0,
  synced: 0,
  logs: [],
  startedAt: null,
  finishedAt: null
})

const percentage = computed(() => {
  if (!progress.value.total) return 0
  return Math.round((progress.value.scanned + progress.value.failed) / progress.value.total * 100)
})

const progressStatus = computed(() => {
  if (progress.value.status === 'completed') {
    return progress.value.failed > 0 ? 'warning' : 'success'
  }
  return ''
})

const statusText = computed(() => {
  switch (progress.value.status) {
    case 'running': return `扫描中 (${progress.value.scanned + progress.value.failed}/${progress.value.total})`
    case 'completed': return '扫描完成'
    default: return '等待启动'
  }
})

const statusTagType = computed(() => {
  switch (progress.value.status) {
    case 'running': return 'primary'
    case 'completed': return progress.value.failed > 0 ? 'warning' : 'success'
    default: return 'info'
  }
})

/** 打开弹窗并启动扫描 */
async function open() {
  visible.value = true
  progress.value = {
    status: 'idle',
    total: 0,
    scanned: 0,
    failed: 0,
    alerts: 0,
    synced: 0,
    logs: [],
    startedAt: null,
    finishedAt: null
  }

  try {
    await triggerAnomalyScan()
    startPolling()
  } catch (e) {
    ElMessage.error('启动扫描失败')
  }
}

/** 开始轮询进度 */
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await getScanProgress()
      if (res.data) {
        progress.value = res.data
        // 自动滚动到底部
        await nextTick()
        scrollToBottom()
        // 完成后停止轮询
        if (res.data.status === 'completed') {
          stopPolling()
          emit('done')
        }
      }
    } catch (e) {
      // 静默
    }
  }, 1500) // 每 1.5 秒轮询一次
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function scrollToBottom() {
  const el = logContainerRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

function handleClose() {
  stopPolling()
}

onBeforeUnmount(() => {
  stopPolling()
})

defineExpose({ open })
</script>

<style scoped lang="scss">
.progress-header {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 12px 16px;
}

.stat-item {
  text-align: center;

  .stat-label {
    font-size: 12px;
    color: #909399;
  }

  .stat-val {
    font-size: 20px;
    font-weight: 600;
    color: #303133;
    margin-top: 4px;
  }
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.sync-info {
  font-size: 12px;
  color: #67c23a;
}

.log-container {
  height: 300px;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-time {
  color: #6a9955;
  margin-right: 8px;
}

.log-info .log-msg { color: #d4d4d4; }
.log-warning .log-msg { color: #e6a23c; }
.log-error .log-msg { color: #f56c6c; }

.log-empty {
  color: #6a6a6a;
  text-align: center;
  padding-top: 120px;
}

.text-success { color: #67c23a; }
.text-danger { color: #f56c6c; }
.text-warning { color: #e6a23c; }
</style>
