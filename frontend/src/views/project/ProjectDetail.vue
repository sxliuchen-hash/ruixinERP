<!--
  ============================================================
  交易项目详情页（ProjectDetail）
  ============================================================
  页面结构：
    顶部：返回 + 标题（名称 + 状态）+ 操作按钮（刷新/编辑状态）
    左侧：基本信息卡 + 财务摘要卡
    右侧：资金流向图（Sankey，ECharts）
    底部：Tabs
      - 销售合同
      - 采购合同
      - 关联收付款
      - 维持成本明细
      - 关联专利库存
  业务联动：
    - onMounted 自动调用 /profit 接口（服务端会先 refresh 再返回）
    - 手动"刷新聚合"按钮调用 /refresh 后再 /profit
  ============================================================
-->
<template>
  <div class="project-detail-container" v-loading="loading">
    <!-- ===== 顶部：返回 + 标题 ===== -->
    <div class="page-header">
      <div class="title-wrapper">
        <el-button link @click="goBack">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <h3 v-if="detail">
          {{ detail.name }}
          <el-tag
            :type="PROJECT_STATUS_MAP[detail.status]?.type"
            size="small"
            style="margin-left: 8px"
          >
            {{ PROJECT_STATUS_MAP[detail.status]?.label }}
          </el-tag>
        </h3>
      </div>
      <div class="header-actions" v-if="detail">
        <el-button type="success" @click="handleRefresh">
          <el-icon><Refresh /></el-icon>刷新聚合
        </el-button>
        <el-dropdown trigger="click" @command="handleStatusCommand">
          <el-button type="warning">
            变更状态<el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="active" :disabled="detail.status === 'active'">
                恢复进行中
              </el-dropdown-item>
              <el-dropdown-item command="completed" :disabled="detail.status === 'completed'">
                标记完成
              </el-dropdown-item>
              <el-dropdown-item command="cancelled" :disabled="detail.status === 'cancelled'">
                取消
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- ===== 左信息 + 右资金流向 ===== -->
    <el-row :gutter="16" v-if="detail && profit">
      <el-col :span="10">
        <el-card shadow="never" class="info-card">
          <template #header>项目基本信息</template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="项目名称">{{ detail.name }}</el-descriptions-item>
            <el-descriptions-item label="主专利号">{{ detail.patent_no || '-' }}</el-descriptions-item>
            <el-descriptions-item label="客户">{{ detail.customer?.name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="供应商">{{ detail.supplier?.name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="负责人">
              {{ detail.owner_id ? '#' + detail.owner_id : '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="备注">{{ detail.remark || '-' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" class="info-card" style="margin-top: 16px">
          <template #header>财务摘要</template>
          <div class="money-summary">
            <div class="money-row">
              <div class="money-label">销售收入</div>
              <div class="money-val text-primary">¥ {{ formatMoney(profit.summary.sale_amount) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">采购成本</div>
              <div class="money-val">¥ {{ formatMoney(profit.summary.purchase_amount) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">税点成本</div>
              <div class="money-val text-warning">¥ {{ formatMoney(profit.summary.tax_cost) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">维持成本</div>
              <div class="money-val text-danger">¥ {{ formatMoney(profit.summary.maintain_cost) }}</div>
            </div>
            <el-divider style="margin: 12px 0" />
            <div class="money-row">
              <div class="money-label" style="font-weight: 600">毛利润</div>
              <div
                class="money-val"
                :class="profit.summary.gross_profit >= 0 ? 'text-success' : 'text-danger'"
                style="font-size: 18px"
              >
                ¥ {{ formatMoney(profit.summary.gross_profit) }}
              </div>
            </div>
            <div class="formula-tip">
              计算：销售收入 − 采购 − 税点 − 维持
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never" class="sankey-card">
          <template #header>
            <div class="section-header">
              <span>资金流向</span>
              <el-tag
                v-if="profit.summary.gross_profit < 0"
                type="danger"
                size="small"
              >项目亏损</el-tag>
            </div>
          </template>
          <ProfitSankey
            v-if="profit.flows && profit.flows.length"
            :flows="profit.flows"
          />
          <el-empty v-else description="暂无资金流数据" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== Tabs 区 ===== -->
    <el-card shadow="never" class="tabs-card" v-if="detail && profit">
      <el-tabs v-model="activeTab">
        <!-- 销售合同 -->
        <el-tab-pane name="sale">
          <template #label>
            <span>销售合同 ({{ profit.contracts.sale?.length || 0 }})</span>
          </template>
          <el-table :data="profit.contracts.sale || []" border size="small">
            <el-table-column prop="contract_no" label="合同号" width="150" />
            <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }">¥ {{ formatMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="已收款" width="130" align="right">
              <template #default="{ row }">
                <span class="text-success">¥ {{ formatMoney(row.paid_amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="goContract(row.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 采购合同 -->
        <el-tab-pane name="purchase">
          <template #label>
            <span>采购合同 ({{ profit.contracts.purchase?.length || 0 }})</span>
          </template>
          <el-table :data="profit.contracts.purchase || []" border size="small">
            <el-table-column prop="contract_no" label="合同号" width="150" />
            <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }">¥ {{ formatMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="已付款" width="130" align="right">
              <template #default="{ row }">
                <span class="text-warning">¥ {{ formatMoney(row.paid_amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="goContract(row.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 收付款 -->
        <el-tab-pane name="payments">
          <template #label>
            <span>收付款 ({{ detail.payments?.length || 0 }})</span>
          </template>
          <el-table :data="detail.payments || []" border size="small">
            <el-table-column prop="payment_date" label="日期" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.payment_date) }}</template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.type === 'income' ? 'success' : 'danger'" size="small">
                  {{ row.type === 'income' ? '收款' : '付款' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }">
                <span :class="row.type === 'income' ? 'text-success' : 'text-danger'">
                  {{ row.type === 'income' ? '+' : '-' }}¥ {{ formatMoney(row.amount) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="账户" width="140">
              <template #default="{ row }">{{ row.account?.name || '-' }}</template>
            </el-table-column>
            <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
            <el-table-column prop="confirm_status" label="确认" width="90" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="row.confirm_status === 'confirmed' ? 'success' : 'warning'"
                  size="small"
                >
                  {{ row.confirm_status === 'confirmed' ? '已确认' : '待确认' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 维持成本 -->
        <el-tab-pane name="maintain">
          <template #label>
            <span>维持成本 ({{ profit.maintain_fees?.length || 0 }})</span>
          </template>
          <el-table :data="profit.maintain_fees || []" border size="small">
            <el-table-column prop="fee_date" label="缴费日" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.fee_date) }}</template>
            </el-table-column>
            <el-table-column prop="fee_type" label="类型" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="FEE_TYPE_MAP[row.fee_type]?.type" size="small">
                  {{ FEE_TYPE_MAP[row.fee_type]?.label || row.fee_type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }">
                <span class="text-danger">¥ {{ formatMoney(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="patent_no" label="专利号" width="150" />
            <el-table-column prop="patent_name" label="专利名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="deadline_date" label="维持至" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.deadline_date) || '-' }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 库存 -->
        <el-tab-pane name="inventory">
          <template #label>
            <span>关联专利 ({{ detail.inventories?.length || 0 }})</span>
          </template>
          <el-table :data="detail.inventories || []" border size="small">
            <el-table-column prop="patent_no" label="专利号" width="150" />
            <el-table-column prop="patent_name" label="名称" min-width="200" show-overflow-tooltip />
            <el-table-column label="采购价" width="120" align="right">
              <template #default="{ row }">¥ {{ formatMoney(row.purchase_price) }}</template>
            </el-table-column>
            <el-table-column label="现价" width="120" align="right">
              <template #default="{ row }">
                <span class="text-primary">¥ {{ formatMoney(row.current_price) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="维持成本" width="120" align="right">
              <template #default="{ row }">
                <span class="text-danger">¥ {{ formatMoney(row.total_maintain_cost) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="goInventory(row.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowDown, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getProjectDetail,
  getProjectProfit,
  changeProjectStatus,
  refreshProject
} from '@/api/project'
import { formatMoney, formatDate } from '@/utils/format'
import { PROJECT_STATUS_MAP, FEE_TYPE_MAP } from '@/utils/constants'
import ProfitSankey from './ProfitSankey.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const detail = ref(null)
const profit = ref(null)
const activeTab = ref('sale')

// ===== 数据拉取 =====

async function fetchAll() {
  loading.value = true
  try {
    const id = parseInt(route.params.id, 10)
    // 并发拉两个接口（profit 会触发后端先刷新再返回）
    const [detailRes, profitRes] = await Promise.all([
      getProjectDetail(id),
      getProjectProfit(id)
    ])
    detail.value = detailRes.data
    profit.value = profitRes.data
  } catch (e) {
    console.error('获取项目详情失败', e)
  } finally {
    loading.value = false
  }
}

// ===== 交互 =====

function goBack() { router.push('/projects') }
function goContract(id) { router.push(`/contracts/${id}`) }
function goInventory(id) { router.push(`/inventory/${id}`) }

async function handleRefresh() {
  try {
    await refreshProject(detail.value.id)
    ElMessage.success('聚合数据已刷新')
    fetchAll()
  } catch (e) {
    // 拦截器已提示
  }
}

async function handleStatusCommand(command) {
  const label = PROJECT_STATUS_MAP[command]?.label || command
  try {
    await ElMessageBox.confirm(`确定将项目状态变更为"${label}"？`, '提示', { type: 'warning' })
    await changeProjectStatus(detail.value.id, command)
    ElMessage.success('状态变更成功')
    fetchAll()
  } catch (e) {
    // 用户取消
  }
}

onMounted(() => {
  fetchAll()
})
</script>

<style scoped lang="scss">
.project-detail-container {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  padding: 12px 16px;
  border-radius: 4px;
  margin-bottom: 16px;
}

.title-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;

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

.info-card,
.sankey-card {
  height: 100%;
}

.tabs-card {
  margin-top: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.money-summary {
  padding: 8px 4px;
}

.money-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;

  .money-label {
    font-size: 13px;
    color: #606266;
  }

  .money-val {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }
}

.formula-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  text-align: right;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
