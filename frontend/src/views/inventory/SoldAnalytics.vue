<!--
  ============================================================
  已售专利统计分析（SoldAnalytics）
  ============================================================
  顶部：KPI 卡片 8 项（总数/总收入/总利润/平均利润/利润率/平均持有/亏损数/本月销量）
  中部：图表区
    - 月度销售趋势（双轴：数量+收入+利润）
    - 资源类型饼图（按数量）
    - 持有天数分布柱图
    - 买家 TOP10 横向柱图
  底部：已售归档列表（筛选 + 分页 + 撤销已售）
  ============================================================
-->
<template>
  <div class="sold-analytics">
    <div class="page-header">
      <h3>已售专利统计</h3>
      <div class="header-actions">
        <el-button @click="$router.push('/inventory')">
          <el-icon><Back /></el-icon>返回库存
        </el-button>
        <el-button type="primary" plain @click="refreshAll">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
      </div>
    </div>

    <!-- ===== KPI 卡片 ===== -->
    <el-row :gutter="12" class="kpi-row">
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">已售总数</div>
          <div class="kpi-value">{{ stats.total_sold || 0 }}</div>
          <div class="kpi-sub">本月新增 {{ stats.month_sold || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">销售总收入</div>
          <div class="kpi-value text-primary">¥{{ formatMoney(stats.total_revenue) }}</div>
          <div class="kpi-sub">本月 ¥{{ formatMoney(stats.month_revenue) }}</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">实际总利润</div>
          <div class="kpi-value" :class="(stats.total_profit||0) >= 0 ? 'text-success' : 'text-danger'">
            ¥{{ formatMoney(stats.total_profit) }}
          </div>
          <div class="kpi-sub">利润率 {{ stats.profit_rate || 0 }}%</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">平均单笔利润</div>
          <div class="kpi-value text-warning">¥{{ formatMoney(stats.avg_profit) }}</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">平均持有天数</div>
          <div class="kpi-value">{{ stats.avg_holding_days || 0 }}<span class="kpi-unit">天</span></div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">亏损笔数</div>
          <div class="kpi-value text-danger">{{ stats.loss_count || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">本月销量</div>
          <div class="kpi-value">{{ stats.month_sold || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="3">
        <el-card shadow="never" class="kpi-card">
          <div class="kpi-label">本月收入</div>
          <div class="kpi-value text-primary">¥{{ formatMoney(stats.month_revenue) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 图表区 ===== -->
    <el-row :gutter="16" class="chart-row">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>近 12 个月销售趋势</span>
            </div>
          </template>
          <div ref="trendChartRef" class="chart-container" style="height: 320px"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>
            <div class="card-header"><span>资源类型分布</span></div>
          </template>
          <div ref="typeChartRef" class="chart-container" style="height: 320px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-row">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header"><span>持有天数分布</span></div>
          </template>
          <div ref="holdingChartRef" class="chart-container" style="height: 280px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header"><span>买家 TOP 10（按收入）</span></div>
          </template>
          <div ref="buyerChartRef" class="chart-container" style="height: 280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 已售归档列表 ===== -->
    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="card-header">
          <span>已售归档列表</span>
          <div class="list-filters">
            <el-input
              v-model="query.keyword"
              placeholder="专利号/名称/买家"
              clearable
              style="width: 200px"
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            />
            <el-select v-model="query.profit_type" placeholder="盈亏" clearable style="width: 100px" @change="handleSearch">
              <el-option label="盈利" value="positive" />
              <el-option label="亏损" value="negative" />
            </el-select>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="成交起"
              end-placeholder="成交止"
              value-format="YYYY-MM-DD"
              style="width: 240px"
              @change="handleDateChange"
            />
            <el-select v-model="sortMode" style="width: 130px" @change="handleSearch">
              <el-option label="时间↓" value="time_desc" />
              <el-option label="时间↑" value="time_asc" />
              <el-option label="利润↓" value="profit_desc" />
              <el-option label="利润↑" value="profit_asc" />
              <el-option label="价格↓" value="price_desc" />
            </el-select>
            <el-button type="primary" @click="handleSearch">
              <el-icon><Search /></el-icon>搜索
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="list" v-loading="listLoading" border stripe>
        <el-table-column prop="patent_no" label="专利号" width="150" fixed="left" />
        <el-table-column prop="patent_name" label="名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="资源类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="RESOURCE_TYPE_MAP[row.resource_type]?.type" size="small">
              {{ RESOURCE_TYPE_MAP[row.resource_type]?.label || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="买家" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <div>{{ row.buyer_name || '-' }}</div>
            <div v-if="row.buyer_contact" class="sub-text">{{ row.buyer_contact }}</div>
          </template>
        </el-table-column>
        <el-table-column label="采购价" width="110" align="right">
          <template #default="{ row }">¥ {{ formatMoney(row.purchase_price) }}</template>
        </el-table-column>
        <el-table-column label="成交价" width="110" align="right">
          <template #default="{ row }">
            <span class="text-primary">¥ {{ formatMoney(row.sold_price) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="维护成本" width="110" align="right">
          <template #default="{ row }">
            <span class="text-danger">¥ {{ formatMoney(row.total_maintain_cost) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实际利润" width="120" align="right">
          <template #default="{ row }">
            <span :class="(row.actual_profit||0) >= 0 ? 'text-success' : 'text-danger'">
              <strong>¥ {{ formatMoney(row.actual_profit) }}</strong>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="持有天数" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.holding_days !== null">{{ row.holding_days }}天</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="成交时间" width="160" align="center">
          <template #default="{ row }">{{ formatDateTime(row.sold_time) || '-' }}</template>
        </el-table-column>
        <el-table-column label="销售合同" width="140">
          <template #default="{ row }">
            <span v-if="row.sale_contract">{{ row.sale_contract.contract_no }}</span>
            <span v-else class="sub-text">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="goDetail(row)">详情</el-button>
            <el-button
              v-if="!isAgent"
              type="warning"
              link
              size="small"
              @click="handleUnsell(row)"
            >撤销已售</el-button>
          </template>
        </el-table-column>
      </el-table>

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
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Back, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as echarts from 'echarts'
import {
  getSoldList,
  getSoldStats,
  getSoldAnalytics,
  unsellInventory
} from '@/api/inventory'
import { formatMoney } from '@/utils/format'
import { RESOURCE_TYPE_MAP } from '@/utils/constants'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const isAgent = computed(() => userStore.userInfo?.role === 'agent')

// ===== KPI =====
const stats = ref({})

// ===== 图表 =====
const trendChartRef = ref(null)
const typeChartRef = ref(null)
const holdingChartRef = ref(null)
const buyerChartRef = ref(null)
let trendChart = null
let typeChart = null
let holdingChart = null
let buyerChart = null

// ===== 列表 =====
const listLoading = ref(false)
const list = ref([])
const dateRange = ref([])
const sortMode = ref('time_desc')
const query = reactive({
  keyword: '',
  profit_type: '',
  sold_time_start: '',
  sold_time_end: ''
})
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// ===== 数据格式化 =====
function formatDateTime(s) {
  if (!s) return ''
  return String(s).replace('T', ' ').slice(0, 16)
}

// ===== 拉取数据 =====
async function fetchStats() {
  try {
    const res = await getSoldStats()
    stats.value = res.data || {}
  } catch (e) {}
}

async function fetchAnalytics() {
  try {
    const res = await getSoldAnalytics()
    const data = res.data || {}
    await nextTick()
    renderTrend(data.trend || [])
    renderType(data.byType || [])
    renderHolding(data.holdingDist || [])
    renderBuyers(data.topBuyers || [])
  } catch (e) {}
}

async function fetchList() {
  listLoading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (query.keyword) params.keyword = query.keyword
    if (query.profit_type) params.profit_type = query.profit_type
    if (query.sold_time_start) params.sold_time_start = query.sold_time_start
    if (query.sold_time_end) params.sold_time_end = query.sold_time_end

    // 排序
    const [sortField, sortOrder] = sortMode.value.split('_')
    params.sort = sortField
    params.order = sortOrder

    const res = await getSoldList(params)
    list.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {} finally {
    listLoading.value = false
  }
}

function refreshAll() {
  fetchStats()
  fetchAnalytics()
  fetchList()
}

// ===== 图表渲染 =====
function renderTrend(trend) {
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['销售数量', '销售收入', '实际利润'] },
    grid: { left: 50, right: 60, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: trend.map(r => r.month)
    },
    yAxis: [
      { type: 'value', name: '数量', position: 'left' },
      { type: 'value', name: '金额(元)', position: 'right' }
    ],
    series: [
      {
        name: '销售数量',
        type: 'bar',
        data: trend.map(r => r.count),
        itemStyle: { color: '#409eff' }
      },
      {
        name: '销售收入',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: trend.map(r => r.revenue),
        itemStyle: { color: '#67c23a' }
      },
      {
        name: '实际利润',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: trend.map(r => r.profit),
        itemStyle: { color: '#e6a23c' }
      }
    ]
  })
}

function renderType(byType) {
  if (!typeChart) typeChart = echarts.init(typeChartRef.value)
  typeChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '65%'],
      data: byType.map(r => ({
        name: RESOURCE_TYPE_MAP[r.resource_type]?.label || r.resource_type,
        value: r.count
      })),
      label: { formatter: '{b}\n{d}%' }
    }]
  })
}

function renderHolding(dist) {
  if (!holdingChart) holdingChart = echarts.init(holdingChartRef.value)
  holdingChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 30, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: dist.map(r => r.range) },
    yAxis: { type: 'value', name: '数量' },
    series: [{
      type: 'bar',
      data: dist.map(r => r.count),
      itemStyle: { color: '#909399' },
      label: { show: true, position: 'top' }
    }]
  })
}

function renderBuyers(buyers) {
  if (!buyerChart) buyerChart = echarts.init(buyerChartRef.value)
  const reversed = [...buyers].reverse()
  buyerChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 120, right: 40, top: 20, bottom: 30 },
    xAxis: { type: 'value', name: '收入(元)' },
    yAxis: {
      type: 'category',
      data: reversed.map(r => r.buyer_name)
    },
    series: [{
      type: 'bar',
      data: reversed.map(r => r.revenue),
      itemStyle: { color: '#409eff' },
      label: { show: true, position: 'right', formatter: ({ value }) => '¥' + formatMoney(value) }
    }]
  })
}

// ===== 交互 =====
function handleSearch() {
  pagination.page = 1
  fetchList()
}

function handleDateChange(val) {
  if (val && val.length === 2) {
    query.sold_time_start = val[0]
    query.sold_time_end = val[1]
  } else {
    query.sold_time_start = ''
    query.sold_time_end = ''
  }
  handleSearch()
}

function goDetail(row) {
  router.push(`/inventory/${row.id}`)
}

async function handleUnsell(row) {
  try {
    await ElMessageBox.confirm(
      `确定撤销专利「${row.patent_no}」的已售状态？\n销售记录将清空，状态恢复为"在库"。`,
      '撤销已售',
      { type: 'warning' }
    )
    await unsellInventory(row.id)
    ElMessage.success('已撤销')
    refreshAll()
  } catch (e) {
    // 用户取消
  }
}

// ===== 响应式重绘 =====
function handleResize() {
  trendChart?.resize()
  typeChart?.resize()
  holdingChart?.resize()
  buyerChart?.resize()
}

onMounted(() => {
  refreshAll()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  typeChart?.dispose()
  holdingChart?.dispose()
  buyerChart?.dispose()
})
</script>

<style scoped lang="scss">
.sold-analytics {
  padding: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
  }
}

.header-actions {
  display: flex;
  gap: 8px;
}

.kpi-row {
  margin-bottom: 12px;
}

.kpi-card {
  :deep(.el-card__body) {
    padding: 12px;
  }
}

.kpi-label {
  font-size: 12px;
  color: #909399;
}

.kpi-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-top: 4px;
}

.kpi-unit {
  margin-left: 4px;
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.kpi-sub {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.chart-row {
  margin-bottom: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
}

.list-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.list-card {
  margin-top: 12px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.chart-container {
  width: 100%;
}

.sub-text {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
