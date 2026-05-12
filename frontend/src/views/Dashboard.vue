<!--
  ============================================================
  Dashboard 首页
  ============================================================
  展示内容（8 个指标卡片 + 2 个图表 + 1 个账户表）：

  第一行指标：
    现金流入 / 现金流出 / 现金净额 / 账户总余额
  第二行指标：
    应收 / 应付 / 毛利润（粗估） / 待确认单据

  图表：
    左侧（占 2/3 宽）- 近 12 个月收支趋势折线图
    右侧（占 1/3 宽）- 成本构成饼图

  底部：
    启用账户列表（含实时余额）

  接口调用（通过 api/dashboard.js，统一前缀 /api/v1/dashboard）：
    GET /overview       ?period=month|quarter|year
    GET /accounts
    GET /trend
    GET /cost-breakdown ?period=month|quarter|year
    GET /pending
    （/aging 暂未渲染，留待后续增强）

  时间切换逻辑：
    顶部 radio-group 切换 period，触发 fetchAll 刷新所有数据

  待确认提醒：
    若 pending.total > 0，顶部显示 el-alert 警告条
  ============================================================
-->
<template>
  <div class="dashboard-container">
    <!-- ===== 顶部：标题 + 时间范围切换 ===== -->
    <div class="dashboard-header">
      <div>
        <h2>财务概览</h2>
        <p class="subtitle">{{ periodLabel }} · 数据更新于 {{ updatedAt }}</p>
      </div>
      <el-radio-group v-model="period" @change="fetchAll">
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="quarter">本季</el-radio-button>
        <el-radio-button value="year">本年</el-radio-button>
      </el-radio-group>
    </div>

    <!-- ===== 待确认提醒（企微审批同步来的记录） ===== -->
    <el-alert
      v-if="pending.total > 0"
      :title="`您有 ${pending.total} 条待确认单据（收付款 ${pending.payments}，合同 ${pending.contracts}）`"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 16px"
    />

    <!-- ===== 第一行：现金流相关 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard label="现金流入" :value="overview.cash_in" color="success" :icon="CirclePlus" />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard label="现金流出" :value="overview.cash_out" color="danger" :icon="Remove" />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <!-- 净额颜色动态：正数用 primary，负数用 danger -->
        <StatCard
          label="现金净额"
          :value="overview.cash_net"
          :color="overview.cash_net >= 0 ? 'primary' : 'danger'"
          :icon="Money"
        />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard
          label="账户总余额"
          :value="accountTotal"
          color="info"
          :icon="Wallet"
          :subtitle="`${accounts.length} 个账户`"
        />
      </el-col>
    </el-row>

    <!-- ===== 第二行：应收应付 + 利润 + 待确认 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard label="应收账款" :value="overview.receivable" color="warning" :icon="DocumentAdd" />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard label="应付账款" :value="overview.payable" color="warning" :icon="Document" />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard
          label="毛利润"
          :value="overview.gross_profit"
          :color="overview.gross_profit >= 0 ? 'success' : 'danger'"
          :icon="TrendCharts"
          :subtitle="`已完成项目 ¥${formatMoney(overview.completed_profit)} · ${overview.project_count || 0} 个项目`"
        />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <!-- 待确认是计数不是金额，所以 prefix="" -->
        <StatCard
          label="待确认单据"
          :value="pending.total"
          color="warning"
          :icon="Warning"
          prefix=""
          :subtitle="`收付款 ${pending.payments} · 合同 ${pending.contracts}`"
        />
      </el-col>
    </el-row>

    <!-- ===== 图表区：趋势图 + 成本饼图 ===== -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-card__title">近 12 个月收支趋势</div>
          <TrendChart :months="trend.months" :income="trend.income" :expense="trend.expense" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-card__title">成本构成</div>
          <CostPieChart :data="pieData" />
        </div>
      </el-col>
    </el-row>

    <!-- ===== 账户列表 ===== -->
    <div class="chart-card" style="margin-top: 16px">
      <div class="chart-card__title">账户余额</div>
      <el-table :data="accounts" stripe>
        <el-table-column prop="name" label="账户名称" min-width="140" />
        <el-table-column prop="bank_name" label="开户行" min-width="140" />
        <el-table-column prop="account_type" label="类型" width="80" align="center">
          <template #default="{ row }">
            {{ row.account_type === 'public' ? '公户' : '私户' }}
          </template>
        </el-table-column>
        <el-table-column label="余额" width="180" align="right">
          <template #default="{ row }">
            <span class="money">¥ {{ formatMoney(row.balance) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  CirclePlus, Remove, Money, Wallet, DocumentAdd, Document, TrendCharts, Warning
} from '@element-plus/icons-vue'
import {
  getOverview,
  getAccountsOverview,
  getTrend,
  getCostBreakdown,
  getPending
} from '@/api/dashboard'
import { formatMoney } from '@/utils/format'
import StatCard from '@/components/dashboard/StatCard.vue'
import TrendChart from '@/components/dashboard/TrendChart.vue'
import CostPieChart from '@/components/dashboard/CostPieChart.vue'

// ===== 响应式状态 =====
const period = ref('month') // 时间范围：month/quarter/year
const updatedAt = ref('')   // 最后更新时间戳（用于展示）

// 核心指标（overview 接口返回）
const overview = reactive({
  cash_in: 0,
  cash_out: 0,
  cash_net: 0,
  receivable: 0,
  payable: 0,
  gross_profit: 0,
  completed_profit: 0,
  project_count: 0,
  completed_count: 0
})

const accounts = ref([])      // 账户列表
const accountTotal = ref(0)   // 账户余额合计
const trend = reactive({ months: [], income: [], expense: [] }) // 趋势图数据
const costList = ref([])      // 成本构成列表
const pending = reactive({ payments: 0, contracts: 0, total: 0 }) // 待确认数量

// ===== 计算属性 =====
const periodLabel = computed(() => {
  return period.value === 'year' ? '本年度' : period.value === 'quarter' ? '本季度' : '本月'
})

// 饼图数据格式转换：{category_name, total} → {name, value}
const pieData = computed(() =>
  costList.value.map(c => ({ name: c.category_name, value: c.total }))
)

// ===== 数据获取 =====
async function fetchOverview() {
  const res = await getOverview({ period: period.value })
  Object.assign(overview, res.data || {})
}

async function fetchAccounts() {
  const res = await getAccountsOverview()
  accounts.value = res.data?.list || []
  accountTotal.value = res.data?.total || 0
}

async function fetchTrend() {
  const res = await getTrend()
  const data = res.data || {}
  trend.months = data.months || []
  trend.income = data.income || []
  trend.expense = data.expense || []
}

async function fetchCostBreakdown() {
  const res = await getCostBreakdown({ period: period.value })
  costList.value = res.data?.list || []
}

async function fetchPending() {
  const res = await getPending()
  Object.assign(pending, res.data || {})
}

/**
 * 并发拉取所有 Dashboard 数据
 * - 五个接口相互独立，用 Promise.all 并发执行减少等待
 * - 任一失败不阻塞其他（后续可考虑用 allSettled 做更宽容的错误处理）
 */
async function fetchAll() {
  updatedAt.value = new Date().toLocaleString('zh-CN')
  await Promise.all([
    fetchOverview(),
    fetchAccounts(),
    fetchTrend(),
    fetchCostBreakdown(),
    fetchPending()
  ])
}

onMounted(fetchAll)
</script>

<style scoped lang="scss">
.dashboard-container {
  padding: 20px;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;

  h2 {
    margin: 0 0 4px;
    font-size: 20px;
    color: #303133;
  }

  .subtitle {
    margin: 0;
    font-size: 13px;
    color: #909399;
  }
}

.stat-row {
  margin-bottom: 16px;
}

.chart-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  height: 100%;

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 16px;
  }
}

.money {
  font-weight: 500;
  color: #303133;
}
</style>
