<!--
  批量扫描进度弹窗
  - 可关闭弹窗（任务继续后台运行）
  - 再次打开可继续查看进度
  - 停止按钮可中断任务
  - 完成/停止后显示结果摘要
-->
<template>
  <el-dialog
    v-model="visible"
    title="批量更新全量信息"
    width="750px"
    :close-on-click-modal="true"
    @open="onOpen"
    @close="handleClose"
  >
    <!-- 进度概览 -->
    <div class="progress-header">
      <el-row :gutter="12">
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-label">总数</div>
            <div class="stat-val">{{ progress.total }}</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-label">已完成</div>
            <div class="stat-val text-success">{{ progress.scanned }}</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-label">失败</div>
            <div class="stat-val text-danger">{{ progress.failed }}</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-label">发现异常</div>
            <div class="stat-val text-warning">{{ progress.alerts }}</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-label">同步更新</div>
            <div class="stat-val text-primary">{{ progress.synced || 0 }}</div>
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

    <!-- 状态栏 -->
    <div class="status-bar">
      <el-tag :type="statusTagType" size="small" effect="dark">{{ statusText }}</el-tag>
      <span v-if="progress.startedAt" class="time-info">
        开始于 {{ formatTime(progress.startedAt) }}
      </span>
      <span v-if="progress.finishedAt" class="time-info">
        · 结束于 {{ formatTime(progress.finishedAt) }}
      </span>
      <span v-if="isRunning" class="time-info">
        · 预计剩余 {{ estimatedRemaining }}
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
        {{ isRunning ? '等待日志...' : '暂无日志' }}
      </div>
    </div>

    <!-- 底部操作 -->
    <template #footer>
      <div class="footer-bar">
        <div class="footer-left">
          <el-button
            v-if="isRunning"
            type="danger"
            plain
            :loading="stopLoading"
            @click="handleStop"
          >
            ⏹ 停止扫描
          </el-button>
          <span v-if="isRunning" class="footer-tip">
            关闭弹窗不会中断任务，可随时重新打开查看进度
          </span>
        </div>
        <div class="footer-right">
          <el-button v-if="!isRunning && !isIdle" @click="visible = false">关闭</el-button>
          <el-button
            v-if="!isRunning"
            type="primary"
            @click="handleStart"
            :disabled="isIdle && starting"
            :loading="starting"
          >
            {{ isIdle ? '开始扫描' : '重新扫描' }}
          </el-button>
          <el-button v-if="isRunning" @click="visible = false">最小化</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { getScanProgress, triggerAnomalyScan, stopAnomalyScan } from '@/api/inventory'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['done'])

const visible = ref(false)
const logContainerRef = ref(null)
const stopLoading = ref(false)
const starting = ref(false)
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

const isRunning = computed(() => progress.value.status === 'running')
const isIdle = computed(() => progress.value.status === 'idle')

const percentage = computed(() => {
  if (!progress.value.total) return 0
  return Math.round((progress.value.scanned + progress.value.failed) / progress.value.total * 100)
})

const progressStatus = computed(() => {
  const s = progress.value.status
  if (s === 'completed') return progress.value.failed > 0 ? 'warning' : 'success'
  if (s === 'stopped') return 'exception'
  return ''
})

const statusText = computed(() => {
  switch (progress.value.status) {
    case 'running': return `扫描中 ${progress.value.scanned + progress.value.failed}/${progress.value.total}`
    case 'completed': return '✓ 扫描完成'
    case 'stopped': return '⏹ 已停止'
    default: return '就绪'
  }
})

const statusTagType = computed(() => {
  switch (progress.value.status) {
    case 'running': return 'primary'
    case 'completed': return progress.value.failed > 0 ? 'warning' : 'success'
    case 'stopped': return 'danger'
    default: return 'info'
  }
})

/** 预估剩余时间 */
const estimatedRemaining = computed(() => {
  if (!progress.value.startedAt || !progress.value.total) return '-'
  const done = progress.value.scanned + progress.value.failed
  if (done === 0) return '计算中...'
  const elapsed = Date.now() - new Date(progress.value.startedAt).getTime()
  const perItem = elapsed / done
  const remaining = perItem * (progress.value.total - done)
  const mins = Math.round(remaining / 60000)
  if (mins < 1) return '< 1 分钟'
  return `${mins} 分钟`
})

/** 打开弹窗（仅查看，不自动启动） */
function open() {
  visible.value = true
}

/** 打开弹窗并启动扫描 */
function openAndStart() {
  visible.value = true
  handleStart()
}

function onOpen() {
  // 打开时立即拉取一次当前进度
  fetchProgress()
  startPolling()
}

/** 启动扫描 */
async function handleStart() {
  try {
    await ElMessageBox.confirm(
      `将对所有在库专利（${progress.value.total || '全部'}条）调用 IP 系统获取全量信息。\n\n` +
      '· 每条间隔 3 秒，每 20 条暂停 30 秒\n' +
      '· 预计耗时 30-40 分钟\n' +
      '· 可随时停止\n\n确定开始？',
      '批量更新全量信息',
      { type: 'info', confirmButtonText: '开始', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }

  starting.value = true
  try {
    const res = await triggerAnomalyScan()
    if (res.success === false) {
      ElMessage.warning(res.message || '任务已在运行中')
    }
    startPolling()
  } catch (e) {
    ElMessage.error('启动失败')
  } finally {
    starting.value = false
  }
}

/** 停止扫描 */
async function handleStop() {
  try {
    await ElMessageBox.confirm('确定停止当前扫描？已完成的部分不会丢失。', '停止扫描', { type: 'warning' })
  } catch (e) {
    return
  }

  stopLoading.value = true
  try {
    await stopAnomalyScan()
    ElMessage.success('停止信号已发送，等待当前专利处理完毕...')
  } catch (e) {
    // 拦截器已提示
  } finally {
    stopLoading.value = false
  }
}

/** 拉取进度 */
async function fetchProgress() {
  try {
    const res = await getScanProgress()
    if (res.data) {
      progress.value = res.data
      await nextTick()
      scrollToBottom()
    }
  } catch (e) {
    // 静默
  }
}

/** 开始轮询 */
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await fetchProgress()
    // 完成或停止后停止轮询
    if (progress.value.status === 'completed' || progress.value.status === 'stopped') {
      stopPolling()
      emit('done')
    }
  }, 2000)
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

function formatTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('zh-CN')
}

onBeforeUnmount(() => {
  stopPolling()
})

defineExpose({ open, openAndStart })
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
    font-size: 11px;
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
  gap: 10px;
  margin-bottom: 12px;
}

.time-info {
  font-size: 12px;
  color: #909399;
}

.log-container {
  height: 320px;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.log-time {
  color: #6a9955;
  margin-right: 8px;
}

.log-info .log-msg { color: #d4d4d4; }
.log-warning .log-msg { color: #e6a23c; font-weight: 500; }
.log-error .log-msg { color: #f56c6c; }

.log-empty {
  color: #6a6a6a;
  text-align: center;
  padding-top: 140px;
}

.footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.footer-right {
  display: flex;
  gap: 8px;
}

.footer-tip {
  font-size: 12px;
  color: #909399;
}

.text-success { color: #67c23a; }
.text-danger { color: #f56c6c; }
.text-warning { color: #e6a23c; }
.text-primary { color: #409eff; }
</style>
