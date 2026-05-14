<template>
  <div class="performance-dashboard">
    <!-- 顶部筛选 -->
    <div class="filter-bar">
      <el-date-picker
        v-model="selectedMonth"
        type="month"
        placeholder="选择月份"
        format="YYYY年MM月"
        value-format="YYYY-MM"
        @change="handleMonthChange"
      />
      <el-radio-group v-model="scope" @change="handleScopeChange">
        <el-radio-button value="company">公司业务</el-radio-button>
        <el-radio-button value="boss">老板</el-radio-button>
        <el-radio-button value="partner">合伙人</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 概览卡片 -->
    <el-row :gutter="16" class="overview-cards">
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">本月销售毛利</div>
            <div class="stat-value">¥{{ formatMoney(overview.current_month?.gross_profit) }}</div>
            <div class="stat-footer">
              <span :class="overview.growth_rate >= 0 ? 'up' : 'down'">
                <el-icon><component :is="overview.growth_rate >= 0 ? 'Top' : 'Bottom'" /></el-icon>
                {{ Math.abs(overview.growth_rate || 0) }}%
              </span>
              <span class="label">较上月</span>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">本月签约数</div>
            <div class="stat-value">{{ overview.current_month?.contract_count || 0 }}</div>
            <div class="stat-footer">
              <span class="label">上月 {{ overview.previous_month?.contract_count || 0 }} 单</span>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">上月销售毛利</div>
            <div class="stat-value">¥{{ formatMoney(overview.previous_month?.gross_profit) }}</div>
            <div class="stat-footer">
              <span class="label">环比参考</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 排名 + 趋势 -->
    <el-row :gutter="16" class="main-content">
      <!-- 左侧：排名表 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>{{ monthLabel }} 业绩排名</span>
              <el-tag v-if="scope === 'company'" type="info" size="small">公司业务</el-tag>
              <el-tag v-else-if="scope === 'boss'" type="warning" size="small">老板业务</el-tag>
              <el-tag v-else type="success" size="small">合伙人业务</el-tag>
            </div>
          </template>
          <el-table :data="ranking" stripe v-loading="loadingRanking" size="small">
            <el-table-column label="排名" width="60" align="center">
              <template #default="{ row }">
                <span :class="'rank-' + row.rank" class="rank-badge">{{ row.rank }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="姓名" width="80" />
            <el-table-column label="职级" width="60" align="center">
              <template #default="{ row }">
                <el-tag :type="gradeTagType(row.grade)" size="small">{{ row.grade }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="签约数" prop="contract_count" width="70" align="center" />
            <el-table-column label="毛利(元)" align="right">
              <template #default="{ row }">
                <span class="money">{{ formatMoney(row.gross_profit) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="提成(元)" align="right" v-if="scope === 'company'">
              <template #default="{ row }">
                <span class="money commission">{{ formatMoney(row.commission) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="分成" align="right" v-if="scope === 'partner'">
              <template #default="{ row }">
                <div>
                  <div class="money">本人70%: ¥{{ formatMoney(row.partner_income) }}</div>
                  <div class="money sub">老板30%: ¥{{ formatMoney(row.boss_share) }}</div>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- 右侧：趋势图 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>业绩趋势</span>
              <el-select v-model="trendMonths" size="small" style="width: 100px" @change="loadTrend">
                <el-option :value="3" label="近3月" />
                <el-option :value="6" label="近6月" />
                <el-option :value="12" label="近12月" />
              </el-select>
            </div>
          </template>
          <div ref="trendChartRef" class="chart-container" v-loading="loadingTrend"></div>
        </el-card>

        <!-- 季度考核 -->
        <el-card style="margin-top: 16px" v-if="scope === 'company'">
          <template #header>
            <div class="card-header">
              <span>季度职级考核</span>
              <div>
                <el-select v-model="quarterYear" size="small" style="width: 80px" @change="loadQuarterly">
                  <el-option v-for="y in yearOptions" :key="y" :value="y" :label="y + '年'" />
                </el-select>
                <el-select v-model="quarterNum" size="small" style="width: 80px; margin-left: 8px" @change="loadQuarterly">
                  <el-option :value="1" label="Q1" />
                  <el-option :value="2" label="Q2" />
                  <el-option :value="3" label="Q3" />
                  <el-option :value="4" label="Q4" />
                </el-select>
              </div>
            </div>
          </template>
          <el-table :data="quarterly" stripe size="small" v-loading="loadingQuarterly">
            <el-table-column prop="name" label="姓名" width="80" />
            <el-table-column label="季度毛利" align="right">
              <template #default="{ row }">
                <span class="money">{{ formatMoney(row.gross_profit) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="当前职级" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="gradeTagType(row.current_grade)" size="small">{{ row.current_grade }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="建议职级" width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="gradeTagType(row.suggested_grade)"
                  size="small"
                  :effect="row.suggested_grade !== row.current_grade ? 'dark' : 'plain'"
                >
                  {{ row.suggested_grade }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="津贴" width="70" align="right">
              <template #default="{ row }">
                {{ row.grade_allowance }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Top, Bottom } from '@element-plus/icons-vue'
import {
  getPerformanceOverview,
  getPerformanceRanking,
  getPerformanceTrend,
  getQuarterlySummary
} from '@/api/performance'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart, LineChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent,
  CanvasRenderer
])

// ===== 状态 =====
const now = new Date()
const selectedMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const scope = ref('company')
const trendMonths = ref(6)
const quarterYear = ref(now.getFullYear())
const quarterNum = ref(Math.floor(now.getMonth() / 3) + 1)

const overview = ref({})
const ranking = ref([])
const quarterly = ref([])

const loadingRanking = ref(false)
const loadingTrend = ref(false)
const loadingQuarterly = ref(false)

const trendChartRef = ref(null)
let chartInstance = null

// ===== 计算属性 =====
const monthLabel = computed(() => {
  const [y, m] = selectedMonth.value.split('-')
  return `${y}年${parseInt(m)}月`
})

const yearOptions = computed(() => {
  const current = now.getFullYear()
  return [current - 1, current, current + 1]
})

// ===== 方法 =====
function formatMoney(val) {
  if (!val && val !== 0) return '0'
  return parseFloat(val).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function gradeTagType(grade) {
  const map = { A: 'info', B: '', C: 'success', D: 'warning', E: 'danger' }
  return map[grade] || 'info'
}

function getYearMonth() {
  const [y, m] = selectedMonth.value.split('-')
  return { year: parseInt(y), month: parseInt(m) }
}

async function loadOverview() {
  try {
    const { year, month } = getYearMonth()
    const res = await getPerformanceOverview({ year, month })
    if (res.data?.success) overview.value = res.data.data
  } catch (e) {
    console.error('加载概览失败', e)
  }
}

async function loadRanking() {
  loadingRanking.value = true
  try {
    const { year, month } = getYearMonth()
    const res = await getPerformanceRanking({ year, month, scope: scope.value })
    if (res.data?.success) ranking.value = res.data.data
  } catch (e) {
    console.error('加载排名失败', e)
  } finally {
    loadingRanking.value = false
  }
}

async function loadTrend() {
  loadingTrend.value = true
  try {
    const res = await getPerformanceTrend({ months: trendMonths.value, scope: scope.value })
    if (res.data?.success) {
      renderTrendChart(res.data.data)
    }
  } catch (e) {
    console.error('加载趋势失败', e)
  } finally {
    loadingTrend.value = false
  }
}

async function loadQuarterly() {
  loadingQuarterly.value = true
  try {
    const res = await getQuarterlySummary({ year: quarterYear.value, quarter: quarterNum.value })
    if (res.data?.success) quarterly.value = res.data.data
  } catch (e) {
    console.error('加载季度数据失败', e)
  } finally {
    loadingQuarterly.value = false
  }
}

function renderTrendChart(data) {
  if (!trendChartRef.value) return

  if (!chartInstance) {
    chartInstance = echarts.init(trendChartRef.value)
  }

  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']

  const series = data.series.map((s, i) => ({
    name: s.name,
    type: 'line',
    data: s.data.map(v => parseFloat((v / 10000).toFixed(2))),
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    itemStyle: { color: colors[i % colors.length] }
  }))

  // 添加公司合计柱状图
  series.unshift({
    name: data.total.name,
    type: 'bar',
    data: data.total.data.map(v => parseFloat((v / 10000).toFixed(2))),
    barWidth: '30%',
    itemStyle: { color: 'rgba(84, 112, 198, 0.2)' },
    z: 0
  })

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        let html = `<div style="font-weight:bold">${params[0].axisValue}</div>`
        params.forEach(p => {
          if (p.value > 0) {
            html += `<div>${p.marker} ${p.seriesName}: ${p.value}万</div>`
          }
        })
        return html
      }
    },
    legend: {
      data: [data.total.name, ...data.series.map(s => s.name)],
      bottom: 0,
      textStyle: { fontSize: 11 }
    },
    grid: { top: 20, right: 20, bottom: 50, left: 50 },
    xAxis: {
      type: 'category',
      data: data.months.map(m => m.slice(5) + '月'),
      axisLabel: { fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      name: '万元',
      axisLabel: { fontSize: 11 }
    },
    series
  }

  chartInstance.setOption(option, true)
}

function handleMonthChange() {
  loadOverview()
  loadRanking()
}

function handleScopeChange() {
  loadRanking()
  loadTrend()
}

// ===== 生命周期 =====
onMounted(async () => {
  await Promise.all([loadOverview(), loadRanking(), loadQuarterly()])
  await nextTick()
  loadTrend()

  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})

function handleResize() {
  chartInstance?.resize()
}
</script>

<style scoped lang="scss">
.performance-dashboard {
  padding: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.overview-cards {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
  padding: 8px 0;

  .stat-label {
    font-size: 13px;
    color: #909399;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 28px;
    font-weight: 600;
    color: #303133;
  }

  .stat-footer {
    margin-top: 8px;
    font-size: 12px;
    color: #909399;

    .up {
      color: #67c23a;
    }

    .down {
      color: #f56c6c;
    }

    .label {
      margin-left: 4px;
    }
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chart-container {
  height: 300px;
}

.rank-badge {
  display: inline-block;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: bold;
}

.rank-1 {
  background: #f7ba2a;
  color: #fff;
}

.rank-2 {
  background: #c0c4cc;
  color: #fff;
}

.rank-3 {
  background: #cd7f32;
  color: #fff;
}

.money {
  font-family: 'DIN Alternate', monospace;
  font-weight: 500;

  &.commission {
    color: #67c23a;
  }

  &.sub {
    font-size: 11px;
    color: #909399;
  }
}

.main-content {
  .el-card {
    height: fit-content;
  }
}
</style>
