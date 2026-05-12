<!--
  ============================================================
  借款管理页（LoanList）
  ============================================================
  页面结构：
    顶部：标题 + 搜索 + 筛选（状态/借款人/账户/日期） + 新建按钮
    统计卡片：借款总额 / 已还总额 / 未还余额 / 未还清数
    列表：日期/借款人/金额/已还/剩余/状态/用途/账户/操作
    分页：标准
    弹窗：新建/编辑借款单
    弹窗：还款（关联某笔借款）
    抽屉：还款明细列表
  业务联动：
    - 新增/删除还款会触发后端事务，自动重算 repaid_amount 和 status
    - 借款/还款会自动影响付款账户的余额（由 accountService 聚合）
  ============================================================
-->
<template>
  <div class="loan-list-container">
    <!-- ===== 顶部：标题 + 筛选 ===== -->
    <div class="page-header">
      <h3>借款管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索用途/备注/审批单号"
          clearable
          style="width: 220px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-date-picker
          v-model="filterDateRange"
          type="daterange"
          range-separator="~"
          start-placeholder="起始日期"
          end-placeholder="截止日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
          @change="handleSearch"
        />
        <el-input
          v-model="filterUserId"
          placeholder="借款人 ID"
          clearable
          style="width: 140px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <AccountSelect v-model="filterAccount" placeholder="账户" style="width: 160px" @update:modelValue="handleSearch" />
        <el-select v-model="filterStatus" placeholder="还款状态" clearable style="width: 120px" @change="handleSearch">
          <el-option
            v-for="(val, key) in LOAN_STATUS_MAP"
            :key="key"
            :label="val.label"
            :value="key"
          />
        </el-select>
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建借款
        </el-button>
      </div>
    </div>

    <!-- ===== 统计卡片 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">借款总额</div>
            <div class="stat-value text-primary">¥ {{ formatMoney(summary?.total?.total_amount || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">已还总额</div>
            <div class="stat-value text-success">¥ {{ formatMoney(summary?.total?.repaid_amount || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">未还余额</div>
            <div class="stat-value text-danger">¥ {{ formatMoney(summary?.total?.remaining_amount || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">未还清</div>
            <div class="stat-value">
              {{ (summary?.by_status?.unpaid?.count || 0) + (summary?.by_status?.partial?.count || 0) }}
              <span class="stat-sub">笔</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 列表 ===== -->
    <el-table :data="loanList" v-loading="loading" border stripe>
      <el-table-column prop="loan_date" label="借款日期" width="110" align="center">
        <template #default="{ row }">{{ formatDate(row.loan_date) }}</template>
      </el-table-column>
      <el-table-column prop="user_id" label="借款人" width="100" align="center">
        <template #default="{ row }">#{{ row.user_id }}</template>
      </el-table-column>
      <el-table-column label="借款金额" width="130" align="right">
        <template #default="{ row }">
          <span class="text-primary">¥ {{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已还" width="130" align="right">
        <template #default="{ row }">
          <span class="text-success">¥ {{ formatMoney(row.repaid_amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="剩余" width="130" align="right">
        <template #default="{ row }">
          <span class="text-danger">¥ {{ formatMoney(row.remaining_amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="LOAN_STATUS_MAP[row.status]?.type" size="small">
            {{ LOAN_STATUS_MAP[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="purpose" label="借款用途" min-width="180" show-overflow-tooltip />
      <el-table-column label="账户" width="140">
        <template #default="{ row }">{{ row.account ? row.account.name : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="260" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'paid'"
            type="success"
            link
            size="small"
            @click="handleRepay(row)"
          >还款</el-button>
          <el-button type="primary" link size="small" @click="handleViewRepayments(row)">明细</el-button>
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
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

    <!-- ===== 新建/编辑借款弹窗 ===== -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑借款单' : '新建借款单'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="借款人" prop="user_id">
              <el-input-number
                v-model="formData.user_id"
                :min="1"
                placeholder="用户 ID"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="借款日期" prop="loan_date">
              <el-date-picker
                v-model="formData.loan_date"
                type="date"
                placeholder="请选择日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="借款金额" prop="amount">
              <el-input-number
                v-model="formData.amount"
                :precision="2"
                :step="1000"
                :min="0"
                style="width: 100%"
                placeholder="请输入金额"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="付款账户" prop="account_id">
              <AccountSelect v-model="formData.account_id" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="借款用途" prop="purpose">
          <el-input
            v-model="formData.purpose"
            placeholder="请输入借款用途"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="审批单号" prop="sp_no">
          <el-input v-model="formData.sp_no" placeholder="企微审批单号（选填）" maxlength="50" />
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 还款弹窗 ===== -->
    <el-dialog
      v-model="repayDialogVisible"
      title="新增还款"
      width="540px"
      destroy-on-close
    >
      <div v-if="currentLoan" class="repay-info">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="借款人">#{{ currentLoan.user_id }}</el-descriptions-item>
          <el-descriptions-item label="借款日期">{{ formatDate(currentLoan.loan_date) }}</el-descriptions-item>
          <el-descriptions-item label="借款金额">¥ {{ formatMoney(currentLoan.amount) }}</el-descriptions-item>
          <el-descriptions-item label="已还">¥ {{ formatMoney(currentLoan.repaid_amount) }}</el-descriptions-item>
          <el-descriptions-item label="剩余应还" :span="2">
            <span class="text-danger">¥ {{ formatMoney(currentLoan.remaining_amount) }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form
        ref="repayFormRef"
        :model="repayFormData"
        :rules="repayFormRules"
        label-width="100px"
        style="margin-top: 16px"
      >
        <el-form-item label="还款金额" prop="amount">
          <el-input-number
            v-model="repayFormData.amount"
            :precision="2"
            :step="100"
            :min="0"
            :max="currentLoan ? currentLoan.remaining_amount : undefined"
            style="width: 100%"
            placeholder="请输入还款金额"
          />
        </el-form-item>
        <el-form-item label="还款日期" prop="repay_date">
          <el-date-picker
            v-model="repayFormData.repay_date"
            type="date"
            placeholder="请选择日期"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="收款账户" prop="account_id">
          <AccountSelect v-model="repayFormData.account_id" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="repayFormData.remark" placeholder="备注（选填）" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="repayDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="repaySubmitLoading" @click="handleRepaySubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 还款明细抽屉 ===== -->
    <el-drawer
      v-model="detailDrawerVisible"
      title="还款明细"
      size="640px"
      destroy-on-close
    >
      <div v-if="detailLoan" class="detail-wrapper">
        <el-descriptions :column="2" size="small" border title="借款基本信息">
          <el-descriptions-item label="借款人">#{{ detailLoan.user_id }}</el-descriptions-item>
          <el-descriptions-item label="借款日期">{{ formatDate(detailLoan.loan_date) }}</el-descriptions-item>
          <el-descriptions-item label="借款金额">¥ {{ formatMoney(detailLoan.amount) }}</el-descriptions-item>
          <el-descriptions-item label="已还">¥ {{ formatMoney(detailLoan.repaid_amount) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="LOAN_STATUS_MAP[detailLoan.status]?.type" size="small">
              {{ LOAN_STATUS_MAP[detailLoan.status]?.label }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="剩余应还">
            <span class="text-danger">¥ {{ formatMoney(detailLoan.remaining_amount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="借款用途" :span="2">{{ detailLoan.purpose || '-' }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="section-title">还款记录（{{ detailLoan.repayments?.length || 0 }} 笔）</h4>
        <el-table :data="detailLoan.repayments || []" border size="small">
          <el-table-column prop="repay_date" label="日期" width="110" align="center">
            <template #default="{ row }">{{ formatDate(row.repay_date) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="130" align="right">
            <template #default="{ row }">
              <span class="text-success">¥ {{ formatMoney(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="账户" min-width="140">
            <template #default="{ row }">{{ row.account ? row.account.name : '-' }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button type="danger" link size="small" @click="handleDeleteRepayment(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getLoanList,
  getLoanDetail,
  createLoan,
  updateLoan,
  deleteLoan,
  addRepayment,
  deleteRepayment,
  getLoanSummary
} from '@/api/loan'
import { formatMoney, formatDate } from '@/utils/format'
import { LOAN_STATUS_MAP } from '@/utils/constants'
import AccountSelect from '@/components/business/AccountSelect.vue'

// ===== 列表状态 =====
const loading = ref(false)
const loanList = ref([])
const searchKeyword = ref('')
const filterDateRange = ref([])
const filterUserId = ref('')
const filterAccount = ref(null)
const filterStatus = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 统计
const summary = ref(null)

// ===== 新建/编辑弹窗 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentEditing = ref(null)

const formData = reactive({
  user_id: null,
  amount: null,
  loan_date: new Date().toISOString().slice(0, 10),
  purpose: '',
  account_id: null,
  sp_no: '',
  remark: ''
})

const formRules = {
  user_id: [{ required: true, message: '请填写借款人', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入借款金额', trigger: 'blur' }],
  loan_date: [{ required: true, message: '请选择借款日期', trigger: 'change' }]
}

// ===== 还款弹窗 =====
const repayDialogVisible = ref(false)
const repaySubmitLoading = ref(false)
const repayFormRef = ref(null)
const currentLoan = ref(null) // 当前操作的借款

const repayFormData = reactive({
  amount: null,
  repay_date: new Date().toISOString().slice(0, 10),
  account_id: null,
  remark: ''
})

const repayFormRules = {
  amount: [{ required: true, message: '请输入还款金额', trigger: 'blur' }],
  repay_date: [{ required: true, message: '请选择还款日期', trigger: 'change' }]
}

// ===== 还款明细抽屉 =====
const detailDrawerVisible = ref(false)
const detailLoan = ref(null)

// ===== 数据拉取 =====

async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (filterUserId.value) params.user_id = filterUserId.value
    if (filterAccount.value) params.account_id = filterAccount.value
    if (filterStatus.value) params.status = filterStatus.value
    if (filterDateRange.value && filterDateRange.value.length === 2) {
      params.start_date = filterDateRange.value[0]
      params.end_date = filterDateRange.value[1]
    }

    const res = await getLoanList(params)
    loanList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取借款列表失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchSummary() {
  try {
    const res = await getLoanSummary({})
    summary.value = res.data || null
  } catch (e) {
    console.error('获取借款汇总失败', e)
  }
}

// ===== 交互 =====

function handleSearch() {
  pagination.page = 1
  fetchList()
}

function resetForm() {
  Object.assign(formData, {
    user_id: null,
    amount: null,
    loan_date: new Date().toISOString().slice(0, 10),
    purpose: '',
    account_id: null,
    sp_no: '',
    remark: ''
  })
}

function handleCreate() {
  isEdit.value = false
  resetForm()
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  currentEditing.value = row
  Object.assign(formData, {
    user_id: row.user_id,
    amount: parseFloat(row.amount),
    loan_date: row.loan_date,
    purpose: row.purpose || '',
    account_id: row.account_id || null,
    sp_no: row.sp_no || '',
    remark: row.remark || ''
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    const data = { ...formData }
    if (!data.sp_no) data.sp_no = null

    if (isEdit.value) {
      await updateLoan(currentEditing.value.id, data)
      ElMessage.success('更新成功')
    } else {
      await createLoan(data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchSummary()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      '删除借款单将同时删除所有还款记录，且会影响账户余额计算，确定继续？',
      '提示',
      { type: 'warning' }
    )
    await deleteLoan(row.id)
    ElMessage.success('删除成功')
    fetchList()
    fetchSummary()
  } catch (e) {
    // 用户取消
  }
}

// ===== 还款流程 =====

function handleRepay(row) {
  currentLoan.value = row
  Object.assign(repayFormData, {
    amount: row.remaining_amount || null,
    repay_date: new Date().toISOString().slice(0, 10),
    account_id: row.account_id || null, // 默认同借款账户
    remark: ''
  })
  repayDialogVisible.value = true
}

async function handleRepaySubmit() {
  const valid = await repayFormRef.value.validate().catch(() => false)
  if (!valid) return

  repaySubmitLoading.value = true
  try {
    await addRepayment(currentLoan.value.id, { ...repayFormData })
    ElMessage.success('还款记录已添加')
    repayDialogVisible.value = false
    fetchList()
    fetchSummary()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    repaySubmitLoading.value = false
  }
}

// ===== 还款明细 =====

async function handleViewRepayments(row) {
  try {
    const res = await getLoanDetail(row.id)
    detailLoan.value = res.data
    detailDrawerVisible.value = true
  } catch (e) {
    console.error('获取借款详情失败', e)
  }
}

async function handleDeleteRepayment(repayment) {
  try {
    await ElMessageBox.confirm(
      `删除该笔 ¥${formatMoney(repayment.amount)} 的还款记录？删除后剩余应还将增加。`,
      '提示',
      { type: 'warning' }
    )
    await deleteRepayment(detailLoan.value.id, repayment.id)
    ElMessage.success('已删除')
    // 刷新详情和列表
    const res = await getLoanDetail(detailLoan.value.id)
    detailLoan.value = res.data
    fetchList()
    fetchSummary()
  } catch (e) {
    // 用户取消
  }
}

onMounted(() => {
  fetchList()
  fetchSummary()
})
</script>

<style scoped lang="scss">
.loan-list-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
    white-space: nowrap;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.stat-row {
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-label {
  font-size: 13px;
  color: #909399;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}

.stat-sub {
  margin-left: 4px;
  font-size: 13px;
  color: #909399;
  font-weight: normal;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.repay-info {
  margin-bottom: 8px;
}

.detail-wrapper {
  padding: 0 8px;
}

.section-title {
  margin: 24px 0 12px;
  font-size: 15px;
  color: #303133;
  font-weight: 600;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
