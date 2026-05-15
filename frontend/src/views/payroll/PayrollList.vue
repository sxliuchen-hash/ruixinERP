<template>
  <div class="payroll-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <h3>工资条管理</h3>
      <div class="header-actions">
        <el-date-picker
          v-model="selectedMonth"
          type="month"
          placeholder="选择月份"
          format="YYYY年MM月"
          value-format="YYYY-MM"
          @change="fetchData"
        />
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 100px" @change="fetchData">
          <el-option label="草稿" value="draft" />
          <el-option label="已确认" value="confirmed" />
          <el-option label="已发放" value="paid" />
        </el-select>
        <el-button type="primary" @click="handleGenerate" :loading="generating">
          生成本月工资条
        </el-button>
        <el-button type="success" @click="handleConfirmAll" :disabled="summary.draft_count === 0">
          批量确认
        </el-button>
      </div>
    </div>

    <!-- 汇总卡片 -->
    <el-row :gutter="16" class="summary-cards">
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">人数</div>
            <div class="stat-value">{{ summary.total_count }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">应发合计</div>
            <div class="stat-value">¥{{ formatMoney(summary.total_gross) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">扣除合计</div>
            <div class="stat-value deduction">¥{{ formatMoney(summary.total_deduction) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-label">实发合计</div>
            <div class="stat-value net">¥{{ formatMoney(summary.total_net) }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 工资条表格 -->
    <el-table :data="payrollList" v-loading="loading" border stripe size="small" show-summary :summary-method="getSummary">
      <el-table-column prop="employee_name" label="姓名" width="80" fixed />
      <el-table-column label="角色" width="70" align="center">
        <template #default="{ row }">
          <el-tag :type="ROLE_TYPE[row.employee_role]" size="small">{{ ROLE_LABEL[row.employee_role] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="base_salary" label="基本工资" width="85" align="right" />
      <el-table-column prop="position_allowance" label="岗位补贴" width="85" align="right" />
      <el-table-column prop="attendance_bonus" label="全勤" width="60" align="right" />
      <el-table-column prop="grade_allowance" label="职级津贴" width="80" align="right" />
      <el-table-column label="提成" width="90" align="right">
        <template #default="{ row }">
          <span class="commission">{{ row.commission > 0 ? row.commission : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="bonus" label="奖金" width="70" align="right" />
      <el-table-column label="社保" width="80" align="right">
        <template #default="{ row }">
          <span class="deduction-text">-{{ row.social_insurance }}</span>
        </template>
      </el-table-column>
      <el-table-column label="请假" width="90" align="right">
        <template #default="{ row }">
          <span v-if="row.leave_days > 0" class="deduction-text">
            {{ row.leave_days }}天 / -{{ row.leave_deduction }}
          </span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="其他扣款" width="80" align="right">
        <template #default="{ row }">
          <span v-if="row.other_deduction > 0" class="deduction-text">-{{ row.other_deduction }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="net_salary" label="实发" width="90" align="right" fixed="right">
        <template #default="{ row }">
          <strong class="net-salary">{{ row.net_salary }}</strong>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="70" align="center" fixed="right">
        <template #default="{ row }">
          <el-tag :type="STATUS_TYPE[row.status]" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" align="center" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button type="success" link size="small" @click="handleConfirm(row)">确认</el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
          <template v-else-if="row.status === 'confirmed'">
            <el-button type="warning" link size="small" @click="handlePaid(row)">发放</el-button>
          </template>
          <template v-else>
            <span class="paid-label">已发放</span>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="编辑工资条" width="500px" destroy-on-close>
      <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="姓名">{{ editRow.employee_name }}</el-descriptions-item>
        <el-descriptions-item label="月业绩">¥{{ formatMoney(editRow.monthly_profit) }}</el-descriptions-item>
        <el-descriptions-item label="基本工资">{{ editRow.base_salary }}</el-descriptions-item>
        <el-descriptions-item label="提成">{{ editRow.commission }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="100px">
        <el-form-item label="奖金(元)">
          <el-input-number v-model="editForm.bonus" :min="0" :step="100" style="width: 200px" />
        </el-form-item>
        <el-form-item label="请假天数">
          <el-input-number v-model="editForm.leave_days" :min="0" :max="31" :step="0.5" :precision="1" style="width: 200px" />
          <span class="form-tip">有请假则全勤奖为0</span>
        </el-form-item>
        <el-form-item label="其他扣款(元)">
          <el-input-number v-model="editForm.other_deduction" :min="0" :step="50" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  generatePayroll, getPayrollSummary, updatePayroll,
  confirmPayroll, confirmPayrollBatch, markPayrollPaid, deletePayroll
} from '@/api/payroll'

const ROLE_LABEL = { boss: '老板', partner: '合伙人', sales: '销售', purchase: '采购', admin: '内勤' }
const ROLE_TYPE = { boss: 'danger', partner: 'warning', sales: 'success', purchase: '', admin: 'info' }
const STATUS_LABEL = { draft: '草稿', confirmed: '已确认', paid: '已发放' }
const STATUS_TYPE = { draft: 'info', confirmed: 'warning', paid: 'success' }

const now = new Date()
const selectedMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const filterStatus = ref('')
const loading = ref(false)
const generating = ref(false)

const payrollList = ref([])
const summary = ref({ total_count: 0, draft_count: 0, confirmed_count: 0, paid_count: 0, total_gross: 0, total_deduction: 0, total_net: 0 })

const editVisible = ref(false)
const editLoading = ref(false)
const editRow = ref({})
const editForm = reactive({ bonus: 0, leave_days: 0, other_deduction: 0, remark: '' })

function formatMoney(val) {
  if (!val && val !== 0) return '0'
  return parseFloat(val).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function getYearMonth() {
  const [y, m] = selectedMonth.value.split('-')
  return { year: parseInt(y), month: parseInt(m) }
}

async function fetchData() {
  loading.value = true
  try {
    const { year, month } = getYearMonth()
    const params = { year, month }
    if (filterStatus.value) params.status = filterStatus.value
    const res = await getPayrollSummary(params)
    if (res.data?.success) {
      payrollList.value = res.data.data.list || []
      summary.value = res.data.data.summary || summary.value
    }
  } catch (e) {
    console.error('加载失败', e)
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  const { year, month } = getYearMonth()
  try {
    await ElMessageBox.confirm(`确定生成 ${year}年${month}月 全员工资条？`, '生成确认', { type: 'info' })
    generating.value = true
    const res = await generatePayroll({ year, month })
    if (res.data?.success) {
      ElMessage.success(res.data.message)
      fetchData()
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('生成失败')
  } finally {
    generating.value = false
  }
}

async function handleConfirmAll() {
  const { year, month } = getYearMonth()
  try {
    await ElMessageBox.confirm(`确定批量确认 ${year}年${month}月 所有草稿工资条？确认后不可修改。`, '批量确认', { type: 'warning' })
    const res = await confirmPayrollBatch({ year, month })
    if (res.data?.success) {
      ElMessage.success(res.data.message)
      fetchData()
    }
  } catch (e) {}
}

function handleEdit(row) {
  editRow.value = row
  editForm.bonus = parseFloat(row.bonus) || 0
  editForm.leave_days = parseFloat(row.leave_days) || 0
  editForm.other_deduction = parseFloat(row.other_deduction) || 0
  editForm.remark = row.remark || ''
  editVisible.value = true
}

async function submitEdit() {
  editLoading.value = true
  try {
    await updatePayroll(editRow.value.id, editForm)
    ElMessage.success('已更新')
    editVisible.value = false
    fetchData()
  } catch (e) {
    ElMessage.error('更新失败')
  } finally {
    editLoading.value = false
  }
}

async function handleConfirm(row) {
  try {
    await ElMessageBox.confirm(`确认 ${row.employee_name} 的工资条？确认后不可修改。`, '确认', { type: 'warning' })
    await confirmPayroll(row.id)
    ElMessage.success('已确认')
    fetchData()
  } catch (e) {}
}

async function handlePaid(row) {
  try {
    await ElMessageBox.confirm(`标记 ${row.employee_name} 的工资条为已发放？`, '发放确认')
    await markPayrollPaid(row.id)
    ElMessage.success('已标记发放')
    fetchData()
  } catch (e) {}
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除 ${row.employee_name} 的工资条？`, '删除确认', { type: 'warning' })
    await deletePayroll(row.id)
    ElMessage.success('已删除')
    fetchData()
  } catch (e) {}
}

function getSummary({ columns, data }) {
  const sums = []
  columns.forEach((col, index) => {
    if (index === 0) { sums[index] = '合计'; return }
    const prop = col.property
    if (['base_salary', 'position_allowance', 'attendance_bonus', 'grade_allowance', 'commission', 'bonus', 'social_insurance', 'leave_deduction', 'other_deduction', 'net_salary'].includes(prop)) {
      const total = data.reduce((sum, row) => sum + (parseFloat(row[prop]) || 0), 0)
      sums[index] = total.toFixed(0)
    } else {
      sums[index] = ''
    }
  })
  return sums
}

onMounted(fetchData)
</script>

<style scoped lang="scss">
.payroll-container {
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
  gap: 12px;
  align-items: center;
}

.summary-cards {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
  .stat-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 600; color: #303133; }
  .stat-value.deduction { color: #f56c6c; }
  .stat-value.net { color: #67c23a; }
}

.commission { color: #e6a23c; font-weight: 500; }
.deduction-text { color: #f56c6c; }
.net-salary { color: #67c23a; font-size: 13px; }
.paid-label { color: #909399; font-size: 12px; }
.form-tip { font-size: 12px; color: #909399; margin-left: 8px; }
</style>
