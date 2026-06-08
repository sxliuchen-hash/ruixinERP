<!--
  ============================================================
  采购提成报表页（PurchaseCommission）
  ============================================================
  展示某月各采购人员卖出"自营专利"的提成。
  数据源：GET /performance/purchase-commission（按卖出时间衰减档计提）

  - 顶部按采购人员汇总卡片
  - 展开查看每人卖出明细（专利/持有天数/提成）
  - 仅 admin 可访问（含水印）
  ============================================================
-->
<template>
  <div class="pc-container">
    <div class="page-header">
      <h3>采购提成报表</h3>
      <div class="header-actions">
        <el-date-picker
          v-model="selectedMonth"
          type="month"
          placeholder="选择月份"
          format="YYYY年MM月"
          value-format="YYYY-MM"
          @change="fetchData"
        />
        <el-button type="primary" :loading="loading" @click="fetchData">查询</el-button>
      </div>
    </div>

    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      仅统计采购人员（角色=采购）卖出"自营专利"（resource_type=own）的提成，按卖出时间距采购时间的衰减档计提。
      档位规则在「薪资规则 → 采购提成」中配置。归属月按成交时间。
    </el-alert>

    <!-- 汇总卡片 -->
    <el-row :gutter="16" class="summary-cards">
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">采购人员</div>
            <div class="stat-value">{{ report.length }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">卖出件数合计</div>
            <div class="stat-value">{{ totalSoldCount }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">提成合计</div>
            <div class="stat-value money">¥{{ formatMoney(totalCommission) }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 采购人员汇总表（可展开明细） -->
    <el-table :data="report" v-loading="loading" border stripe row-key="employee_id">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="detail-wrap">
            <el-table v-if="row.items?.length" :data="row.items" border size="small">
              <el-table-column prop="patent_no" label="专利号" min-width="150" show-overflow-tooltip />
              <el-table-column prop="patent_name" label="专利名称" min-width="200" show-overflow-tooltip />
              <el-table-column prop="patent_type" label="类型" width="100" align="center" />
              <el-table-column prop="purchase_date" label="采购日" width="110" align="center" />
              <el-table-column label="成交时间" width="160" align="center">
                <template #default="{ row: it }">{{ formatDateTime(it.sold_time) }}</template>
              </el-table-column>
              <el-table-column prop="holding_days" label="持有天数" width="90" align="center" />
              <el-table-column label="提成" width="100" align="right">
                <template #default="{ row: it }">
                  <span class="money">¥{{ formatMoney(it.commission) }}</span>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else description="本月无卖出自营专利" :image-size="60" />
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="employee_name" label="采购人员" width="140" />
      <el-table-column label="卖出件数" width="120" align="center">
        <template #default="{ row }">{{ row.sold_count }}</template>
      </el-table-column>
      <el-table-column label="提成金额" width="160" align="right">
        <template #default="{ row }">
          <strong class="money">¥{{ formatMoney(row.commission) }}</strong>
        </template>
      </el-table-column>
      <el-table-column label="" min-width="100">
        <template #default="{ row }">
          <span v-if="row.sold_count === 0" class="muted">本月无卖出</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getPurchaseCommission } from '@/api/performance'

const now = new Date()
const selectedMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const loading = ref(false)
const report = ref([])

const totalCommission = computed(() =>
  report.value.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0)
)
const totalSoldCount = computed(() =>
  report.value.reduce((s, r) => s + (parseInt(r.sold_count) || 0), 0)
)

function getYearMonth() {
  const [y, m] = selectedMonth.value.split('-')
  return { year: parseInt(y), month: parseInt(m) }
}

async function fetchData() {
  loading.value = true
  try {
    const { year, month } = getYearMonth()
    const res = await getPurchaseCommission({ year, month })
    report.value = res.data?.data || res.data || []
  } catch (e) {
    ElMessage.error('加载失败：' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

function formatMoney(val) {
  const n = parseFloat(val)
  if (isNaN(n)) return '0.00'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatDateTime(v) {
  if (!v) return '-'
  return new Date(v).toLocaleString('zh-CN')
}

onMounted(fetchData)
</script>

<style scoped lang="scss">
.pc-container {
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
.header-actions { display: flex; gap: 12px; align-items: center; }
.summary-cards { margin-bottom: 16px; }
.stat-card {
  text-align: center;
  .stat-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 600; color: #303133; }
  .stat-value.money { color: #e6a23c; }
}
.detail-wrap { padding: 12px 24px; background: #fafafa; }
.money { color: #e6a23c; font-weight: 500; }
.muted { color: #c0c4cc; font-size: 12px; }
</style>
