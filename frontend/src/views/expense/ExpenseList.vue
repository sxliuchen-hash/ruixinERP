<!--
  ============================================================
  报销管理页（ExpenseList）
  ============================================================
  页面结构：
    顶部：标题 + 搜索 + 筛选（类别/确认状态/账户/日期范围） + 新建按钮
    统计卡片：本月报销、本年报销、待确认总数、类别 Top1
    Tabs：全部 / 待确认(x)
    表格：日期/报销人/类别/金额/摘要/账户/确认状态/操作
    分页：标准
    弹窗：新建/编辑表单
  业务规则：
    - pending（企微同步）/confirmed（人工确认），confirmed 影响账户余额
    - 删除受数据隔离保护（agent 只能删自己创建的）
  待优化（后续任务补）：
    - 报销人下拉选择（需主项目 users 接口，T21 可能提供）
    - 成本类别下拉（T17 完成后）
  ============================================================
-->
<template>
  <div class="expense-list-container">
    <!-- ===== 顶部：标题 + 筛选区 ===== -->
    <div class="page-header">
      <h3>报销管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索摘要/备注/审批单号"
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
          placeholder="报销人 ID"
          clearable
          style="width: 140px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <el-input
          v-model="filterCategory"
          placeholder="类别 ID"
          clearable
          style="width: 120px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <AccountSelect v-model="filterAccount" placeholder="账户" style="width: 160px" @update:modelValue="handleSearch" />
        <el-select v-model="filterConfirm" placeholder="确认状态" clearable style="width: 120px" @change="handleSearch">
          <el-option label="待确认" value="pending" />
          <el-option label="已确认" value="confirmed" />
        </el-select>
        <ExportButton
          path="/export/expenses"
          :params="exportParams"
          label="导出"
        />
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建报销
        </el-button>
      </div>
    </div>

    <!-- ===== 统计卡片（基于月度+类别汇总数据） ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">本月报销</div>
            <div class="stat-value text-primary">¥ {{ formatMoney(statCurrentMonth) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">本年报销</div>
            <div class="stat-value text-warning">¥ {{ formatMoney(statCurrentYear) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">待确认</div>
            <div class="stat-value text-danger">{{ pendingCount }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">最大类别</div>
            <div class="stat-value">
              {{ topCategory ? topCategory.category_name : '-' }}
              <span v-if="topCategory" class="stat-sub">
                ¥ {{ formatMoney(topCategory.amount) }}
              </span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== Tabs：全部 / 待确认 ===== -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange" class="status-tabs">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane :label="`待确认 (${pendingCount})`" name="pending" />
    </el-tabs>

    <!-- ===== 列表 ===== -->
    <el-table :data="expenseList" v-loading="loading" border stripe>
      <el-table-column prop="expense_date" label="费用日期" width="110" align="center">
        <template #default="{ row }">{{ formatDate(row.expense_date) }}</template>
      </el-table-column>
      <el-table-column prop="user_id" label="报销人" width="100" align="center">
        <template #default="{ row }">
          <span>#{{ row.user_id }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="cost_category_id" label="类别" width="100" align="center">
        <template #default="{ row }">
          <span>{{ row.cost_category_id ? `#${row.cost_category_id}` : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="140" align="right">
        <template #default="{ row }">
          <span class="text-danger">¥ {{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="summary" label="摘要" min-width="180" show-overflow-tooltip />
      <el-table-column label="账户" width="140">
        <template #default="{ row }">{{ row.account ? row.account.name : '-' }}</template>
      </el-table-column>
      <el-table-column prop="confirm_status" label="确认" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.confirm_status === 'confirmed' ? 'success' : 'warning'" size="small">
            {{ row.confirm_status === 'confirmed' ? '已确认' : '待确认' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.confirm_status === 'pending'"
            type="success"
            link
            size="small"
            @click="handleConfirm(row)"
          >确认</el-button>
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

    <!-- ===== 新建/编辑弹窗 ===== -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑报销' : '新建报销'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="报销人" prop="user_id">
              <el-input-number
                v-model="formData.user_id"
                :min="1"
                placeholder="用户 ID"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="费用日期" prop="expense_date">
              <el-date-picker
                v-model="formData.expense_date"
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
            <el-form-item label="金额" prop="amount">
              <el-input-number
                v-model="formData.amount"
                :precision="2"
                :step="100"
                :min="0"
                style="width: 100%"
                placeholder="请输入金额"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="类别" prop="cost_category_id">
              <el-input-number
                v-model="formData.cost_category_id"
                :min="1"
                placeholder="类别 ID（T17 补选择器）"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="付款账户" prop="account_id">
              <AccountSelect v-model="formData.account_id" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="确认状态" prop="confirm_status">
              <el-radio-group v-model="formData.confirm_status">
                <el-radio value="confirmed">已确认</el-radio>
                <el-radio value="pending">待确认</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="摘要" prop="summary">
          <el-input
            v-model="formData.summary"
            placeholder="请输入摘要（用于自动归类）"
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getExpenseList,
  createExpense,
  updateExpense,
  deleteExpense,
  confirmExpense,
  getExpenseMonthlySummary,
  getExpenseCategorySummary
} from '@/api/expense'
import { formatMoney, formatDate } from '@/utils/format'
import AccountSelect from '@/components/business/AccountSelect.vue'
import ExportButton from '@/components/common/ExportButton.vue'

// ===== 列表状态 =====
const loading = ref(false)
const expenseList = ref([])
const searchKeyword = ref('')
const filterDateRange = ref([])
const filterUserId = ref('')
const filterCategory = ref('')
const filterAccount = ref(null)
const filterConfirm = ref('')
const activeTab = ref('all')
const pendingCount = ref(0)
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 统计数据
const monthlySummary = ref([])
const categorySummary = ref([])

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterUserId.value) p.user_id = filterUserId.value
  if (filterCategory.value) p.cost_category_id = filterCategory.value
  if (filterAccount.value) p.account_id = filterAccount.value
  if (filterDateRange.value && filterDateRange.value.length === 2) {
    p.start_date = filterDateRange.value[0]
    p.end_date = filterDateRange.value[1]
  }
  if (activeTab.value === 'pending') {
    p.confirm_status = 'pending'
  } else if (filterConfirm.value) {
    p.confirm_status = filterConfirm.value
  }
  return p
})

// 派生：本月报销（expense_date 在当前年月的 confirmed 总额）
const statCurrentMonth = computed(() => {
  const ym = new Date().toISOString().slice(0, 7) // YYYY-MM
  const found = monthlySummary.value.find(m => m.month === ym)
  return found ? found.amount : 0
})

// 派生：本年报销（当前年份所有月份 confirmed 总额之和）
const statCurrentYear = computed(() => {
  const y = new Date().getFullYear().toString()
  return monthlySummary.value
    .filter(m => m.month.startsWith(y))
    .reduce((s, m) => s + (m.amount || 0), 0)
})

// 派生：占比最大的类别
const topCategory = computed(() => {
  return categorySummary.value.length > 0 ? categorySummary.value[0] : null
})

// ===== 弹窗状态 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentExpense = ref(null)

const formData = reactive({
  user_id: null,
  amount: null,
  cost_category_id: null,
  expense_date: new Date().toISOString().slice(0, 10),
  account_id: null,
  sp_no: '',
  confirm_status: 'confirmed',
  summary: '',
  remark: ''
})

const formRules = {
  user_id: [{ required: true, message: '请填写报销人', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  expense_date: [{ required: true, message: '请选择费用日期', trigger: 'change' }]
}

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
    if (filterCategory.value) params.cost_category_id = filterCategory.value
    if (filterAccount.value) params.account_id = filterAccount.value

    if (filterDateRange.value && filterDateRange.value.length === 2) {
      params.start_date = filterDateRange.value[0]
      params.end_date = filterDateRange.value[1]
    }

    // tab 优先于筛选
    if (activeTab.value === 'pending') {
      params.confirm_status = 'pending'
    } else if (filterConfirm.value) {
      params.confirm_status = filterConfirm.value
    }

    const res = await getExpenseList(params)
    expenseList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取报销列表失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchPendingCount() {
  try {
    const res = await getExpenseList({ confirm_status: 'pending', pageSize: 1 })
    pendingCount.value = res.data?.pagination?.total || 0
  } catch (e) {
    pendingCount.value = 0
  }
}

async function fetchStatistics() {
  try {
    const [monthRes, catRes] = await Promise.all([
      getExpenseMonthlySummary({ months: 12 }),
      getExpenseCategorySummary({})
    ])
    monthlySummary.value = monthRes.data || []
    categorySummary.value = catRes.data?.list || []
  } catch (e) {
    console.error('获取报销统计失败', e)
  }
}

// ===== 交互 =====

function handleSearch() {
  pagination.page = 1
  fetchList()
}

function handleTabChange() {
  pagination.page = 1
  fetchList()
}

function resetForm() {
  Object.assign(formData, {
    user_id: null,
    amount: null,
    cost_category_id: null,
    expense_date: new Date().toISOString().slice(0, 10),
    account_id: null,
    sp_no: '',
    confirm_status: 'confirmed',
    summary: '',
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
  currentExpense.value = row
  Object.assign(formData, {
    user_id: row.user_id,
    amount: parseFloat(row.amount),
    cost_category_id: row.cost_category_id || null,
    expense_date: row.expense_date,
    account_id: row.account_id || null,
    sp_no: row.sp_no || '',
    confirm_status: row.confirm_status,
    summary: row.summary || '',
    remark: row.remark || ''
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    const submitData = { ...formData }
    // 空字符串字段转 null 更明确
    if (!submitData.sp_no) submitData.sp_no = null

    if (isEdit.value) {
      // 编辑时 confirm_status 由确认接口变更，这里剥离，避免误提交
      delete submitData.confirm_status
      await updateExpense(currentExpense.value.id, submitData)
      ElMessage.success('更新成功')
    } else {
      await createExpense(submitData)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchPendingCount()
    fetchStatistics()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

async function handleConfirm(row) {
  try {
    await ElMessageBox.confirm(
      `确认该笔 ¥${formatMoney(row.amount)} 的报销记录？确认后将计入账户支出。`,
      '提示',
      { type: 'warning' }
    )
    await confirmExpense(row.id)
    ElMessage.success('已确认')
    fetchList()
    fetchPendingCount()
    fetchStatistics()
  } catch (e) {
    // 用户取消
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm('确定删除该笔报销记录吗？', '提示', { type: 'warning' })
    await deleteExpense(row.id)
    ElMessage.success('删除成功')
    fetchList()
    fetchPendingCount()
    fetchStatistics()
  } catch (e) {
    // 用户取消
  }
}

onMounted(() => {
  fetchList()
  fetchPendingCount()
  fetchStatistics()
})
</script>

<style scoped lang="scss">
.expense-list-container {
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
  margin-left: 8px;
  font-size: 13px;
  color: #909399;
  font-weight: normal;
}

.status-tabs {
  margin-bottom: 8px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.text-primary { color: #409eff; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
