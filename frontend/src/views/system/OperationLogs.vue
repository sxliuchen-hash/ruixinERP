<!--
  ============================================================
  操作日志页（OperationLogs）
  ============================================================
  展示系统所有操作记录，支持按用户/操作类型/业务表/时间筛选
  仅 admin 可见
  ============================================================
-->
<template>
  <div class="logs-container">
    <div class="page-header">
      <h3>操作日志</h3>
      <div class="header-actions">
        <el-date-picker
          v-model="filterDateRange"
          type="daterange"
          range-separator="~"
          start-placeholder="起始"
          end-placeholder="截止"
          value-format="YYYY-MM-DD"
          style="width: 260px"
          @change="handleSearch"
        />
        <el-select v-model="filterAction" placeholder="操作类型" clearable style="width: 120px" @change="handleSearch">
          <el-option label="创建" value="create" />
          <el-option label="更新" value="update" />
          <el-option label="删除" value="delete" />
        </el-select>
        <el-input
          v-model="filterTable"
          placeholder="业务模块"
          clearable
          style="width: 140px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
      </div>
    </div>

    <el-table :data="logList" v-loading="loading" border stripe size="small">
      <el-table-column prop="create_time" label="时间" width="170" align="center">
        <template #default="{ row }">{{ formatTime(row.create_time) }}</template>
      </el-table-column>
      <el-table-column prop="user_name" label="操作人" width="100" align="center">
        <template #default="{ row }">{{ row.user_name || `#${row.user_id}` }}</template>
      </el-table-column>
      <el-table-column prop="action" label="操作" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="ACTION_MAP[row.action]?.type || 'info'" size="small">
            {{ ACTION_MAP[row.action]?.label || row.action }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="target_table" label="模块" width="140" />
      <el-table-column prop="target_id" label="记录ID" width="80" align="center" />
      <el-table-column prop="ip_address" label="IP" width="130" />
      <el-table-column label="变更前" min-width="200">
        <template #default="{ row }">
          <span class="json-preview">{{ truncate(row.before_data, 100) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="变更后" min-width="200">
        <template #default="{ row }">
          <span class="json-preview">{{ truncate(row.after_data, 100) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @size-change="fetchList"
        @current-change="fetchList"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import request from '@/api/request'

const ACTION_MAP = {
  create: { label: '创建', type: 'success' },
  update: { label: '更新', type: 'warning' },
  delete: { label: '删除', type: 'danger' }
}

const loading = ref(false)
const logList = ref([])
const filterDateRange = ref([])
const filterAction = ref('')
const filterTable = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

function formatTime(t) {
  if (!t) return '-'
  return t.replace('T', ' ').slice(0, 19)
}

function truncate(str, len) {
  if (!str) return '-'
  return str.length > len ? str.slice(0, len) + '...' : str
}

async function fetchList() {
  loading.value = true
  try {
    const params = { page: pagination.page, pageSize: pagination.pageSize }
    if (filterAction.value) params.action = filterAction.value
    if (filterTable.value) params.target_table = filterTable.value
    if (filterDateRange.value?.length === 2) {
      params.start_date = filterDateRange.value[0]
      params.end_date = filterDateRange.value[1]
    }
    const res = await request.get('/logs', { params })
    logList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取日志失败', e)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchList()
}

onMounted(fetchList)
</script>

<style scoped lang="scss">
.logs-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  h3 { margin: 0; font-size: 18px; color: #303133; }
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.json-preview {
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}
</style>
