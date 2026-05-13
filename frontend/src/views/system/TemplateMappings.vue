<!--
  ============================================================
  审批模板映射页（TemplateMappings）
  ============================================================
  展示当前配置的审批模板 ID 和同步统计
  仅 admin 可见
  ============================================================
-->
<template>
  <div class="template-container">
    <h3>审批模板映射</h3>

    <el-alert type="info" :closable="false" style="margin-bottom: 20px">
      <template #title>
        审批模板 ID 在后端 .env 中配置。当企微有新审批通过时，系统会自动按模板类型同步到对应的业务表。
      </template>
    </el-alert>

    <!-- 模板配置 -->
    <el-card shadow="never" style="margin-bottom: 20px">
      <template #header>已配置的模板</template>
      <el-table :data="templateList" border size="small">
        <el-table-column prop="type" label="业务类型" width="120" />
        <el-table-column prop="name" label="模板名称" width="140" />
        <el-table-column prop="template_id" label="模板 ID" min-width="300">
          <template #default="{ row }">
            <code v-if="row.template_id">{{ row.template_id }}</code>
            <el-tag v-else type="info" size="small">未配置</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="target" label="写入目标" width="120" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.template_id ? 'success' : 'info'" size="small">
              {{ row.template_id ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 同步统计 -->
    <el-card shadow="never">
      <template #header>同步统计</template>
      <el-row :gutter="16">
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">合同（企微同步）</div>
            <div class="stat-value">{{ stats.contracts }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">付款（企微同步）</div>
            <div class="stat-value">{{ stats.payments }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">今日新增</div>
            <div class="stat-value text-success">{{ stats.today }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">最近同步时间</div>
            <div class="stat-value-sm">{{ stats.lastSync || '-' }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import request from '@/api/request'

const templateList = ref([
  { type: '合同审批', name: '合同审批', template_id: '', target: 'contracts' },
  { type: '付款', name: '付款', template_id: '', target: 'payments' },
  { type: '报销', name: '报销', template_id: '', target: 'expenses' },
  { type: '借款', name: '借款', template_id: '', target: 'loans' }
])

const stats = reactive({
  contracts: 0,
  payments: 0,
  today: 0,
  lastSync: ''
})

async function fetchConfig() {
  try {
    const res = await request.get('/wechat/config')
    const templates = res.data?.templates || {}
    templateList.value[0].template_id = templates.contract || ''
    templateList.value[1].template_id = templates.payment || ''
    templateList.value[2].template_id = templates.expense || ''
    templateList.value[3].template_id = templates.loan || ''
  } catch (e) {
    console.error('获取配置失败', e)
  }
}

async function fetchStats() {
  try {
    // 统计企微同步的记录数
    const [contractRes, paymentRes] = await Promise.all([
      request.get('/contracts', { params: { pageSize: 1, keyword: 'WX-' } }),
      request.get('/payments', { params: { pageSize: 1, keyword: '企微' } })
    ])
    stats.contracts = contractRes.data?.pagination?.total || 0
    stats.payments = paymentRes.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取统计失败', e)
  }
}

onMounted(() => {
  fetchConfig()
  fetchStats()
})
</script>

<style scoped lang="scss">
.template-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
  h3 { margin: 0 0 20px; font-size: 18px; color: #303133; }
}
.stat-card {
  text-align: center;
  padding: 16px;
}
.stat-label { font-size: 13px; color: #909399; margin-bottom: 8px; }
.stat-value { font-size: 28px; font-weight: 600; color: #303133; }
.stat-value-sm { font-size: 14px; color: #606266; }
.text-success { color: #67c23a; }
code { background: #f5f7fa; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
</style>
