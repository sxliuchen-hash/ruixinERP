<!--
  ============================================================
  专利异常告警中心（PatentAnomalyAlerts）
  ============================================================
  功能：
    - 查看一个月内出现的质押/许可/变更/著录项目变更费等异常
    - 醒目展示（红色 danger 行 + 顶部统计卡片）
    - 标记已处理 + 添加处理备注
    - 管理员可手动触发批量扫描
  ============================================================
-->
<template>
  <div class="anomaly-container">
    <!-- ===== 顶部 ===== -->
    <div class="page-header">
      <h3>
        <el-icon><Warning /></el-icon>
        专利异常告警
      </h3>
      <div class="header-actions">
        <el-button
          v-if="userStore.isAdmin"
          type="primary"
          :loading="scanLoading"
          @click="handleTriggerScan"
        >
          <el-icon><Refresh /></el-icon>立即扫描
        </el-button>
      </div>
    </div>

    <!-- ===== 统计卡片 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" :class="{ 'card-danger': overview.danger > 0 }">
          <div class="stat-card">
            <div class="stat-label">紧急告警（疑似转让）</div>
            <div class="stat-value text-danger">{{ overview.danger || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">警告（质押/许可）</div>
            <div class="stat-value text-warning">{{ overview.warning || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">提示</div>
            <div class="stat-value text-info">{{ overview.info || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">未处理总数</div>
            <div class="stat-value">{{ overview.total || 0 }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 筛选 ===== -->
    <div class="filter-bar">
      <el-input
        v-model="filterPatentNo"
        placeholder="搜索专利号"
        clearable
        style="width: 200px"
        @clear="fetchList"
        @keyup.enter="fetchList"
      />
      <el-select
        v-model="filterSeverity"
        placeholder="严重程度"
        clearable
        style="width: 140px"
        @change="fetchList"
      >
        <el-option
          v-for="(val, key) in ANOMALY_SEVERITY_MAP"
          :key="key"
          :label="val.label"
          :value="key"
        />
      </el-select>
      <el-select
        v-model="filterAnomalyType"
        placeholder="异常类型"
        clearable
        style="width: 160px"
        @change="fetchList"
      >
        <el-option
          v-for="(val, key) in ANOMALY_TYPE_MAP"
          :key="key"
          :label="val.label"
          :value="key"
        />
      </el-select>
      <el-select
        v-model="filterResolved"
        placeholder="处理状态"
        clearable
        style="width: 140px"
        @change="fetchList"
      >
        <el-option label="未处理" :value="0" />
        <el-option label="已处理" :value="1" />
      </el-select>
    </div>

    <!-- ===== 列表 ===== -->
    <el-table
      :data="list"
      v-loading="loading"
      border
      stripe
      :row-class-name="rowClassName"
    >
      <el-table-column prop="severity" label="级别" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="ANOMALY_SEVERITY_MAP[row.severity]?.type" size="small" effect="dark">
            {{ ANOMALY_SEVERITY_MAP[row.severity]?.label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="anomaly_type" label="类型" width="110" align="center">
        <template #default="{ row }">
          <el-tag :type="ANOMALY_TYPE_MAP[row.anomaly_type]?.type" size="small">
            {{ ANOMALY_TYPE_MAP[row.anomaly_type]?.label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="patent_no" label="专利号" width="150">
        <template #default="{ row }">
          <el-button type="primary" link @click="goDetail(row)">{{ row.patent_no }}</el-button>
        </template>
      </el-table-column>
      <el-table-column label="专利名称" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.inventory?.patent_name || '-' }}</template>
      </el-table-column>
      <el-table-column prop="title" label="告警内容" min-width="280" show-overflow-tooltip />
      <el-table-column prop="event_date" label="事件日期" width="110" align="center" />
      <el-table-column label="检测时间" width="160" align="center">
        <template #default="{ row }">{{ formatDateTime(row.detected_at) }}</template>
      </el-table-column>
      <el-table-column label="处理状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.is_resolved ? 'success' : 'danger'" size="small">
            {{ row.is_resolved ? '已处理' : '未处理' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleViewContent(row)">
            查看详情
          </el-button>
          <el-button
            v-if="!row.is_resolved"
            type="success"
            link
            size="small"
            @click="openResolveDialog(row)"
          >
            标记处理
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- ===== 分页 ===== -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="fetchList"
        @current-change="fetchList"
      />
    </div>

    <!-- ===== 详情弹窗 ===== -->
    <el-dialog v-model="contentDialogVisible" title="告警详情" width="600px">
      <el-descriptions v-if="currentRow" :column="1" border size="small">
        <el-descriptions-item label="专利号">{{ currentRow.patent_no }}</el-descriptions-item>
        <el-descriptions-item label="级别">
          <el-tag :type="ANOMALY_SEVERITY_MAP[currentRow.severity]?.type" size="small">
            {{ ANOMALY_SEVERITY_MAP[currentRow.severity]?.label }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ ANOMALY_TYPE_MAP[currentRow.anomaly_type]?.label }}
        </el-descriptions-item>
        <el-descriptions-item label="标题">{{ currentRow.title }}</el-descriptions-item>
        <el-descriptions-item label="详情">
          <pre class="content-pre">{{ currentRow.content }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="事件日期">{{ currentRow.event_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="检测时间">{{ formatDateTime(currentRow.detected_at) }}</el-descriptions-item>
        <el-descriptions-item v-if="currentRow.is_resolved" label="处理人">
          {{ currentRow.resolved_by }}
        </el-descriptions-item>
        <el-descriptions-item v-if="currentRow.is_resolved" label="处理时间">
          {{ formatDateTime(currentRow.resolved_at) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="currentRow.resolution_note" label="处理备注">
          {{ currentRow.resolution_note }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <!-- ===== 标记处理弹窗 ===== -->
    <el-dialog v-model="resolveDialogVisible" title="标记为已处理" width="500px">
      <el-form label-width="80px">
        <el-form-item label="备注">
          <el-input
            v-model="resolveNote"
            type="textarea"
            :rows="4"
            placeholder="请说明处理结果（如：已核实为正常代理变更/已联系专利权人确认/正在调查中）"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="resolveLoading" @click="handleResolve">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Warning, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAnomalies,
  getAnomalyOverview,
  resolveAnomaly,
  triggerAnomalyScan
} from '@/api/inventory'
import { ANOMALY_SEVERITY_MAP, ANOMALY_TYPE_MAP } from '@/utils/constants'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const list = ref([])
const overview = ref({ danger: 0, warning: 0, info: 0, total: 0 })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const filterPatentNo = ref('')
const filterSeverity = ref('')
const filterAnomalyType = ref('')
const filterResolved = ref(0)

const scanLoading = ref(false)

const contentDialogVisible = ref(false)
const currentRow = ref(null)

const resolveDialogVisible = ref(false)
const resolveNote = ref('')
const resolveLoading = ref(false)

async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (filterPatentNo.value) params.patent_no = filterPatentNo.value
    if (filterSeverity.value) params.severity = filterSeverity.value
    if (filterAnomalyType.value) params.anomaly_type = filterAnomalyType.value
    if (filterResolved.value !== '' && filterResolved.value !== null) {
      params.is_resolved = filterResolved.value
    }

    const res = await getAnomalies(params)
    list.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    console.error('获取异常告警失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchOverview() {
  try {
    const res = await getAnomalyOverview()
    overview.value = res.data || { danger: 0, warning: 0, info: 0, total: 0 }
  } catch (e) {
    console.error('获取统计失败', e)
  }
}

function rowClassName({ row }) {
  if (row.is_resolved) return ''
  if (row.severity === 'danger') return 'row-danger'
  if (row.severity === 'warning') return 'row-warning'
  return ''
}

function goDetail(row) {
  if (row.inventory_id) {
    router.push(`/inventory/${row.inventory_id}`)
  }
}

function handleViewContent(row) {
  currentRow.value = row
  contentDialogVisible.value = true
}

function openResolveDialog(row) {
  currentRow.value = row
  resolveNote.value = ''
  resolveDialogVisible.value = true
}

async function handleResolve() {
  if (!currentRow.value) return

  resolveLoading.value = true
  try {
    await resolveAnomaly(currentRow.value.id, resolveNote.value)
    ElMessage.success('已标记为处理')
    resolveDialogVisible.value = false
    fetchList()
    fetchOverview()
  } catch (e) {
    // 拦截器已提示
  } finally {
    resolveLoading.value = false
  }
}

async function handleTriggerScan() {
  try {
    await ElMessageBox.confirm(
      '将启动批量扫描所有在库专利的全量信息（含 IP 系统调用），耗时较长且会消耗 API 配额。确定继续？',
      '触发扫描',
      { type: 'warning' }
    )
  } catch (e) {
    return
  }

  scanLoading.value = true
  try {
    const res = await triggerAnomalyScan()
    ElMessage.success(res.message || '扫描已启动，结果稍后呈现')
    setTimeout(() => {
      fetchList()
      fetchOverview()
    }, 2000)
  } catch (e) {
    // 拦截器已提示
  } finally {
    scanLoading.value = false
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

onMounted(() => {
  fetchList()
  fetchOverview()
})
</script>

<style scoped lang="scss">
.anomaly-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.stat-row {
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}

.card-danger {
  border-left: 4px solid #f56c6c;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { background-color: #fff; }
  50% { background-color: #fef0f0; }
}

.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.content-pre {
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-family: inherit;
  font-size: 13px;
}

:deep(.row-danger) {
  background-color: #fef0f0 !important;
}

:deep(.row-warning) {
  background-color: #fdf6ec !important;
}

.text-danger { color: #f56c6c; }
.text-warning { color: #e6a23c; }
.text-info { color: #909399; }
</style>
