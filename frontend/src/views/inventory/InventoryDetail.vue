<!--
  ============================================================
  专利库存详情页（InventoryDetail）
  ============================================================
  页面结构：
    顶部：返回 + 标题（专利号 + 状态标签）+ 操作按钮（编辑/调价/状态/删除）
    基本信息卡片：名称/类型/领域/采购/入库等 + 派生字段（库龄/利润预估）
    年费记录区：表格 + 新增/删除 + 类型过滤
    调价历史区：时间线展示（最近 → 最早）
  业务联动：
    - 新增/删除年费 → 后端事务内重算 total_maintain_cost / next_fee_deadline
    - 调价成功 → price_history 自动新增一条，无需手工
  ============================================================
-->
<template>
  <div class="inventory-detail-container" v-loading="loading">
    <!-- ===== 顶部：返回 + 标题 ===== -->
    <div class="page-header">
      <div class="title-wrapper">
        <el-button link @click="goBack">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <h3 v-if="detail">
          {{ detail.patent_no }}
          <el-tag
            :type="INVENTORY_STATUS_MAP[detail.status]?.type"
            size="small"
            style="margin-left: 8px"
          >
            {{ INVENTORY_STATUS_MAP[detail.status]?.label }}
          </el-tag>
        </h3>
      </div>
      <div class="header-actions" v-if="detail">
        <el-button type="success" @click="openPriceDialog">
          <el-icon><Money /></el-icon>调价
        </el-button>
        <el-dropdown trigger="click" @command="handleStatusCommand">
          <el-button type="warning">
            变更状态<el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="in_stock" :disabled="detail.status === 'in_stock'">
                回库
              </el-dropdown-item>
              <el-dropdown-item command="sold" :disabled="detail.status === 'sold'">
                标记售出
              </el-dropdown-item>
              <el-dropdown-item command="transferring" :disabled="detail.status === 'transferring'">
                转让中
              </el-dropdown-item>
              <el-dropdown-item command="abandoned" :disabled="detail.status === 'abandoned'">
                放弃
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- ===== 基本信息 + 财务摘要 ===== -->
    <el-row :gutter="16" v-if="detail">
      <el-col :span="16">
        <el-card shadow="never" class="info-card">
          <template #header>专利基本信息</template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="专利号">{{ detail.patent_no }}</el-descriptions-item>
            <el-descriptions-item label="专利类型">{{ detail.patent_type || '-' }}</el-descriptions-item>
            <el-descriptions-item label="专利名称" :span="2">{{ detail.patent_name }}</el-descriptions-item>
            <el-descriptions-item label="技术领域">{{ detail.tech_field || '-' }}</el-descriptions-item>
            <el-descriptions-item label="供应商">
              {{ detail.supplier ? detail.supplier.name : '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="采购合同">
              <el-button
                v-if="detail.contract"
                type="primary"
                link
                size="small"
                @click="router.push(`/contracts/${detail.contract.id}`)"
              >
                {{ detail.contract.contract_no }}
              </el-button>
              <span v-else>-</span>
            </el-descriptions-item>
            <el-descriptions-item label="采购日期">{{ formatDate(detail.purchase_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="入库日期">{{ formatDate(detail.stock_in_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="出库日期">{{ formatDate(detail.stock_out_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="库龄">
              <span v-if="detail.stock_age_days !== null">{{ detail.stock_age_days }} 天</span>
              <span v-else>-</span>
            </el-descriptions-item>
            <el-descriptions-item label="下次年费日" :span="2">
              <span :class="getDeadlineClass(detail.next_fee_deadline)">
                {{ formatDate(detail.next_fee_deadline) || '未设定' }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ detail.remark || '-' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="never" class="info-card">
          <template #header>财务摘要</template>
          <div class="money-summary">
            <div class="money-row">
              <div class="money-label">采购价</div>
              <div class="money-val">¥ {{ formatMoney(detail.purchase_price) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">累计维持成本</div>
              <div class="money-val text-danger">¥ {{ formatMoney(detail.total_maintain_cost) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">当前售价</div>
              <div class="money-val text-primary">¥ {{ formatMoney(detail.current_price) }}</div>
            </div>
            <el-divider style="margin: 12px 0" />
            <div class="money-row">
              <div class="money-label" style="font-weight: 600">利润预估</div>
              <div
                class="money-val"
                :class="detail.estimate_profit >= 0 ? 'text-success' : 'text-danger'"
                style="font-size: 18px"
              >
                ¥ {{ formatMoney(detail.estimate_profit) }}
              </div>
            </div>
            <div class="formula-tip">
              计算：现价 − 采购价 − 累计维持成本
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 年费记录 + 调价历史 ===== -->
    <el-row :gutter="16" class="bottom-row" v-if="detail">
      <el-col :span="14">
        <el-card shadow="never" class="section-card">
          <template #header>
            <div class="section-header">
              <span>年费/维持成本记录（{{ detail.annualFees?.length || 0 }} 笔）</span>
              <el-button type="primary" size="small" @click="openFeeDialog">
                <el-icon><Plus /></el-icon>添加年费
              </el-button>
            </div>
          </template>
          <el-table :data="detail.annualFees || []" border stripe size="small">
            <el-table-column prop="fee_date" label="缴费日" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.fee_date) }}</template>
            </el-table-column>
            <el-table-column prop="fee_type" label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="FEE_TYPE_MAP[row.fee_type]?.type"
                  size="small"
                >
                  {{ FEE_TYPE_MAP[row.fee_type]?.label || row.fee_type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">
                <span class="text-danger">¥ {{ formatMoney(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="deadline_date" label="维持至" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.deadline_date) || '-' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button type="danger" link size="small" @click="handleDeleteFee(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!detail.annualFees?.length" description="暂无年费记录" :image-size="80" />
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never" class="section-card">
          <template #header>
            <span>调价历史（{{ detail.priceHistory?.length || 0 }} 次）</span>
          </template>
          <el-timeline v-if="detail.priceHistory?.length">
            <el-timeline-item
              v-for="h in detail.priceHistory"
              :key="h.id"
              :timestamp="formatDate(h.change_date)"
              placement="top"
              :type="priceTimelineType(h.old_price, h.new_price)"
            >
              <div class="timeline-title">
                <span>¥ {{ formatMoney(h.old_price) }}</span>
                <el-icon style="margin: 0 6px"><ArrowRight /></el-icon>
                <span class="text-primary">¥ {{ formatMoney(h.new_price) }}</span>
                <el-tag
                  :type="priceTimelineType(h.old_price, h.new_price)"
                  size="small"
                  style="margin-left: 8px"
                >
                  {{ priceDeltaLabel(h.old_price, h.new_price) }}
                </el-tag>
              </div>
              <div v-if="h.reason" class="timeline-reason">{{ h.reason }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无调价记录" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 调价弹窗 ===== -->
    <el-dialog
      v-model="priceDialogVisible"
      title="专利调价"
      width="480px"
      destroy-on-close
    >
      <el-descriptions v-if="detail" :column="1" size="small" border>
        <el-descriptions-item label="专利号">{{ detail.patent_no }}</el-descriptions-item>
        <el-descriptions-item label="当前价">¥ {{ formatMoney(detail.current_price) }}</el-descriptions-item>
      </el-descriptions>
      <el-form
        ref="priceFormRef"
        :model="priceFormData"
        :rules="priceFormRules"
        label-width="90px"
        style="margin-top: 16px"
      >
        <el-form-item label="新价格" prop="new_price">
          <el-input-number
            v-model="priceFormData.new_price"
            :precision="2"
            :min="0"
            :step="1000"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="调价日期" prop="change_date">
          <el-date-picker
            v-model="priceFormData.change_date"
            type="date"
            placeholder="默认今日"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="调价原因" prop="reason">
          <el-input v-model="priceFormData.reason" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="priceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="priceSubmitLoading" @click="handlePriceSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 添加年费弹窗 ===== -->
    <el-dialog
      v-model="feeDialogVisible"
      title="添加年费记录"
      width="500px"
      destroy-on-close
    >
      <el-form
        ref="feeFormRef"
        :model="feeFormData"
        :rules="feeFormRules"
        label-width="90px"
      >
        <el-form-item label="费用类型" prop="fee_type">
          <el-radio-group v-model="feeFormData.fee_type">
            <el-radio value="annual">年费</el-radio>
            <el-radio value="agency">代理费</el-radio>
            <el-radio value="other">其他</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <el-input-number
            v-model="feeFormData.amount"
            :precision="2"
            :min="0"
            :step="500"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="缴费日期" prop="fee_date">
          <el-date-picker
            v-model="feeFormData.fee_date"
            type="date"
            placeholder="请选择"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="维持至" prop="deadline_date">
          <el-date-picker
            v-model="feeFormData.deadline_date"
            type="date"
            placeholder="本次缴费能维持到的到期日"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
          <div class="form-tip">保存后会自动更新下次年费日字段</div>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="feeFormData.remark" maxlength="200" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="feeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="feeSubmitLoading" @click="handleFeeSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ArrowDown, Money, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getInventoryDetail,
  changeInventoryStatus,
  changeInventoryPrice,
  addAnnualFee,
  deleteAnnualFee
} from '@/api/inventory'
import { formatMoney, formatDate } from '@/utils/format'
import { INVENTORY_STATUS_MAP, FEE_TYPE_MAP } from '@/utils/constants'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const detail = ref(null)

// ===== 调价弹窗 =====
const priceDialogVisible = ref(false)
const priceSubmitLoading = ref(false)
const priceFormRef = ref(null)
const priceFormData = reactive({
  new_price: 0,
  change_date: new Date().toISOString().slice(0, 10),
  reason: ''
})
const priceFormRules = {
  new_price: [{ required: true, message: '请输入新价格', trigger: 'blur' }],
  change_date: [{ required: true, message: '请选择调价日期', trigger: 'change' }]
}

// ===== 年费弹窗 =====
const feeDialogVisible = ref(false)
const feeSubmitLoading = ref(false)
const feeFormRef = ref(null)
const feeFormData = reactive({
  fee_type: 'annual',
  amount: 0,
  fee_date: new Date().toISOString().slice(0, 10),
  deadline_date: null,
  remark: ''
})
const feeFormRules = {
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  fee_date: [{ required: true, message: '请选择缴费日期', trigger: 'change' }]
}

// ===== 数据拉取 =====

async function fetchDetail() {
  loading.value = true
  try {
    const id = parseInt(route.params.id, 10)
    const res = await getInventoryDetail(id)
    detail.value = res.data || null
  } catch (e) {
    console.error('获取库存详情失败', e)
  } finally {
    loading.value = false
  }
}

// ===== 交互 =====

function goBack() {
  router.push('/inventory')
}

async function handleStatusCommand(command) {
  const label = INVENTORY_STATUS_MAP[command]?.label || command
  try {
    await ElMessageBox.confirm(`确定将该专利状态变更为"${label}"？`, '提示', { type: 'warning' })
    const data = { status: command }
    if (command === 'sold') {
      data.stock_out_date = new Date().toISOString().slice(0, 10)
    }
    await changeInventoryStatus(detail.value.id, data)
    ElMessage.success('状态变更成功')
    fetchDetail()
  } catch (e) {
    // 用户取消
  }
}

function openPriceDialog() {
  Object.assign(priceFormData, {
    new_price: parseFloat(detail.value.current_price) || 0,
    change_date: new Date().toISOString().slice(0, 10),
    reason: ''
  })
  priceDialogVisible.value = true
}

async function handlePriceSubmit() {
  const valid = await priceFormRef.value.validate().catch(() => false)
  if (!valid) return

  priceSubmitLoading.value = true
  try {
    await changeInventoryPrice(detail.value.id, { ...priceFormData })
    ElMessage.success('调价成功')
    priceDialogVisible.value = false
    fetchDetail()
  } catch (e) {
    // 拦截器已提示
  } finally {
    priceSubmitLoading.value = false
  }
}

function openFeeDialog() {
  Object.assign(feeFormData, {
    fee_type: 'annual',
    amount: 0,
    fee_date: new Date().toISOString().slice(0, 10),
    deadline_date: null,
    remark: ''
  })
  feeDialogVisible.value = true
}

async function handleFeeSubmit() {
  const valid = await feeFormRef.value.validate().catch(() => false)
  if (!valid) return

  feeSubmitLoading.value = true
  try {
    await addAnnualFee(detail.value.id, { ...feeFormData })
    ElMessage.success('年费记录已添加')
    feeDialogVisible.value = false
    fetchDetail()
  } catch (e) {
    // 拦截器已提示
  } finally {
    feeSubmitLoading.value = false
  }
}

async function handleDeleteFee(fee) {
  try {
    await ElMessageBox.confirm(
      `删除该笔 ¥${formatMoney(fee.amount)} 的年费记录？删除后维持成本和下次年费日将自动重算。`,
      '提示',
      { type: 'warning' }
    )
    await deleteAnnualFee(detail.value.id, fee.id)
    ElMessage.success('已删除')
    fetchDetail()
  } catch (e) {
    // 用户取消
  }
}

// ===== 工具函数 =====

/** 到期日剩余天数着色 */
function getDeadlineClass(deadline) {
  if (!deadline) return ''
  const today = new Date(new Date().toISOString().slice(0, 10))
  const d = new Date(deadline)
  const diff = Math.floor((d - today) / (24 * 3600 * 1000))
  if (diff <= 7) return 'text-danger'
  if (diff <= 30) return 'text-warning'
  return ''
}

/** 调价方向 → Timeline 类型 */
function priceTimelineType(oldPrice, newPrice) {
  const o = parseFloat(oldPrice) || 0
  const n = parseFloat(newPrice) || 0
  if (n > o) return 'success'
  if (n < o) return 'danger'
  return 'info'
}

/** 调价幅度标签 */
function priceDeltaLabel(oldPrice, newPrice) {
  const o = parseFloat(oldPrice) || 0
  const n = parseFloat(newPrice) || 0
  if (o === 0) return n > 0 ? '新设' : '持平'
  const delta = ((n - o) / o * 100).toFixed(1)
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta}%`
}

onMounted(() => {
  fetchDetail()
})
</script>

<style scoped lang="scss">
.inventory-detail-container {
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

.info-card {
  height: 100%;
}

.bottom-row {
  margin-top: 16px;
}

.section-card {
  height: 100%;
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

.timeline-title {
  display: flex;
  align-items: center;
  font-size: 14px;
}

.timeline-reason {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
  margin-top: 4px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
