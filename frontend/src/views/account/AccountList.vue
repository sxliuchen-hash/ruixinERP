<template>
  <div class="account-list-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <h3>银行账户管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索账户名称/账号"
          clearable
          style="width: 240px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px" @change="handleSearch">
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建账户
        </el-button>
      </div>
    </div>

    <!-- 账户列表表格 -->
    <el-table :data="accountList" v-loading="loading" border stripe>
      <el-table-column prop="name" label="账户名称" min-width="140" />
      <el-table-column prop="bank_name" label="开户行" min-width="140" />
      <el-table-column prop="account_no" label="账号" min-width="180" />
      <el-table-column prop="account_type" label="类型" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="ACCOUNT_TYPE_MAP[row.account_type]?.type || 'info'" size="small">
            {{ ACCOUNT_TYPE_MAP[row.account_type]?.label || row.account_type }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前余额" width="140" align="right">
        <template #default="{ row }">
          <span class="money">{{ formatMoney(row.balance) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 1"
            @change="(val) => handleToggleStatus(row, val)"
            inline-prompt
            active-text="启"
            inactive-text="停"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="warning" link size="small" @click="handleSetBalance(row)">期初余额</el-button>
          <el-button type="success" link size="small" @click="handleViewFlow(row)">流水</el-button>
          <el-button type="info" link size="small" @click="handleTransfer(row)">转账</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
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

    <!-- 新建/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑账户' : '新建账户'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
        <el-form-item label="账户名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入账户名称" />
        </el-form-item>
        <el-form-item label="开户行" prop="bank_name">
          <el-input v-model="formData.bank_name" placeholder="请输入开户行" />
        </el-form-item>
        <el-form-item label="账号" prop="account_no">
          <el-input v-model="formData.account_no" placeholder="请输入银行账号" />
        </el-form-item>
        <el-form-item label="账户类型" prop="account_type">
          <el-radio-group v-model="formData.account_type">
            <el-radio value="public">公户</el-radio>
            <el-radio value="private">私户</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="3" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 期初余额设置弹窗 -->
    <el-dialog v-model="balanceDialogVisible" title="设置期初余额" width="420px" destroy-on-close>
      <el-form ref="balanceFormRef" :model="balanceForm" :rules="balanceRules" label-width="90px">
        <el-form-item label="账户">
          <el-input :model-value="currentAccount?.name" disabled />
        </el-form-item>
        <el-form-item label="期初余额" prop="initial_balance">
          <el-input-number
            v-model="balanceForm.initial_balance"
            :precision="2"
            :step="100"
            :min="0"
            style="width: 100%"
            placeholder="请输入期初余额"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="balanceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleBalanceSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 账户流水弹窗 -->
    <el-dialog v-model="flowDialogVisible" title="账户流水" width="750px" destroy-on-close>
      <div class="flow-header">
        <span>账户：{{ currentAccount?.name }}</span>
        <el-date-picker
          v-model="flowDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          @change="fetchFlow"
          style="width: 260px"
        />
      </div>
      <el-table :data="flowList" v-loading="flowLoading" border stripe max-height="400">
        <el-table-column prop="date" label="日期" width="110">
          <template #default="{ row }">{{ formatDate(row.date) }}</template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.type === 'income' ? 'success' : 'danger'" size="small">
              {{ row.type === 'income' ? '收入' : '支出' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <span :class="row.type === 'income' ? 'text-success' : 'text-danger'">
              {{ row.type === 'income' ? '+' : '-' }}{{ formatMoney(row.amount) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="180" show-overflow-tooltip />
        <el-table-column prop="balance_after" label="余额" width="120" align="right">
          <template #default="{ row }">{{ formatMoney(row.balance_after) }}</template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrapper" v-if="flowPagination.total > 0">
        <el-pagination
          v-model:current-page="flowPagination.page"
          v-model:page-size="flowPagination.pageSize"
          :total="flowPagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, prev, pager, next"
          @current-change="fetchFlow"
        />
      </div>
    </el-dialog>

    <!-- 转账弹窗 -->
    <el-dialog v-model="transferDialogVisible" title="账户间转账" width="480px" destroy-on-close>
      <el-form ref="transferFormRef" :model="transferForm" :rules="transferRules" label-width="100px">
        <el-form-item label="转出账户">
          <el-input :model-value="currentAccount?.name" disabled />
        </el-form-item>
        <el-form-item label="转入账户" prop="to_account_id">
          <el-select v-model="transferForm.to_account_id" placeholder="请选择转入账户" style="width: 100%">
            <el-option
              v-for="item in transferableAccounts"
              :key="item.id"
              :label="`${item.name} (${item.bank_name})`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="转账金额" prop="amount">
          <el-input-number
            v-model="transferForm.amount"
            :precision="2"
            :step="100"
            :min="0.01"
            style="width: 100%"
            placeholder="请输入转账金额"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="transferForm.remark" type="textarea" :rows="2" placeholder="转账备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleTransferSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAccountList,
  createAccount,
  updateAccount,
  setAccountBalance,
  getAccountFlow,
  accountTransfer
} from '@/api/account'
import { formatMoney, formatDate } from '@/utils/format'
import { ACCOUNT_TYPE_MAP } from '@/utils/constants'

// 列表相关
const loading = ref(false)
const accountList = ref([])
const searchKeyword = ref('')
const filterStatus = ref(null)
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// CRUD 弹窗
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentAccount = ref(null)

const formData = reactive({
  name: '',
  bank_name: '',
  account_no: '',
  account_type: 'public',
  remark: ''
})

const formRules = {
  name: [{ required: true, message: '请输入账户名称', trigger: 'blur' }],
  bank_name: [{ required: true, message: '请输入开户行', trigger: 'blur' }],
  account_no: [{ required: true, message: '请输入银行账号', trigger: 'blur' }],
  account_type: [{ required: true, message: '请选择账户类型', trigger: 'change' }]
}

// 期初余额弹窗
const balanceDialogVisible = ref(false)
const balanceFormRef = ref(null)
const balanceForm = reactive({ initial_balance: 0 })
const balanceRules = {
  initial_balance: [{ required: true, message: '请输入期初余额', trigger: 'blur' }]
}

// 流水弹窗
const flowDialogVisible = ref(false)
const flowLoading = ref(false)
const flowList = ref([])
const flowDateRange = ref(null)
const flowPagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 转账弹窗
const transferDialogVisible = ref(false)
const transferFormRef = ref(null)
const transferForm = reactive({
  to_account_id: null,
  amount: null,
  remark: ''
})
const transferRules = {
  to_account_id: [{ required: true, message: '请选择转入账户', trigger: 'change' }],
  amount: [{ required: true, message: '请输入转账金额', trigger: 'blur' }]
}

// 可转入的账户（排除当前账户）
const transferableAccounts = computed(() => {
  if (!currentAccount.value) return []
  return accountList.value.filter(
    (item) => item.id !== currentAccount.value.id && item.status === 1
  )
})

// 获取账户列表
async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (filterStatus.value !== null && filterStatus.value !== '') params.status = filterStatus.value

    const res = await getAccountList(params)
    accountList.value = res.data?.list || res.data || []
    pagination.total = res.data?.total || accountList.value.length
  } catch (error) {
    console.error('获取账户列表失败:', error)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchList()
}

// 新建账户
function handleCreate() {
  isEdit.value = false
  Object.assign(formData, { name: '', bank_name: '', account_no: '', account_type: 'public', remark: '' })
  dialogVisible.value = true
}

// 编辑账户
function handleEdit(row) {
  isEdit.value = true
  currentAccount.value = row
  Object.assign(formData, {
    name: row.name,
    bank_name: row.bank_name,
    account_no: row.account_no,
    account_type: row.account_type,
    remark: row.remark || ''
  })
  dialogVisible.value = true
}

// 提交表单
async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updateAccount(currentAccount.value.id, { ...formData })
      ElMessage.success('编辑成功')
    } else {
      await createAccount({ ...formData })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
  } catch (error) {
    // 错误已由拦截器处理
  } finally {
    submitLoading.value = false
  }
}

// 切换状态
async function handleToggleStatus(row, val) {
  const status = val ? 1 : 0
  const action = status ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(`确定${action}账户「${row.name}」吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await updateAccount(row.id, { status })
    ElMessage.success(`${action}成功`)
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

// 设置期初余额
function handleSetBalance(row) {
  currentAccount.value = row
  balanceForm.initial_balance = row.initial_balance || 0
  balanceDialogVisible.value = true
}

async function handleBalanceSubmit() {
  const valid = await balanceFormRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await setAccountBalance(currentAccount.value.id, {
      initial_balance: balanceForm.initial_balance
    })
    ElMessage.success('期初余额设置成功')
    balanceDialogVisible.value = false
    fetchList()
  } catch (error) {
    // 错误已由拦截器处理
  } finally {
    submitLoading.value = false
  }
}

// 查看流水
function handleViewFlow(row) {
  currentAccount.value = row
  flowDateRange.value = null
  flowPagination.page = 1
  flowDialogVisible.value = true
  fetchFlow()
}

async function fetchFlow() {
  if (!currentAccount.value) return
  flowLoading.value = true
  try {
    const params = {
      page: flowPagination.page,
      pageSize: flowPagination.pageSize
    }
    if (flowDateRange.value && flowDateRange.value.length === 2) {
      params.start_date = flowDateRange.value[0]
      params.end_date = flowDateRange.value[1]
    }
    const res = await getAccountFlow(currentAccount.value.id, params)
    flowList.value = res.data?.list || res.data || []
    flowPagination.total = res.data?.total || flowList.value.length
  } catch (error) {
    console.error('获取流水失败:', error)
  } finally {
    flowLoading.value = false
  }
}

// 转账
function handleTransfer(row) {
  currentAccount.value = row
  Object.assign(transferForm, { to_account_id: null, amount: null, remark: '' })
  transferDialogVisible.value = true
}

async function handleTransferSubmit() {
  const valid = await transferFormRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await accountTransfer({
      from_account_id: currentAccount.value.id,
      to_account_id: transferForm.to_account_id,
      amount: transferForm.amount,
      remark: transferForm.remark
    })
    ElMessage.success('转账成功')
    transferDialogVisible.value = false
    fetchList()
  } catch (error) {
    // 错误已由拦截器处理
  } finally {
    submitLoading.value = false
  }
}

onMounted(() => {
  fetchList()
})
</script>

<style scoped lang="scss">
.account-list-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.money {
  font-weight: 500;
  color: #303133;
}

.text-success {
  color: #67c23a;
  font-weight: 500;
}

.text-danger {
  color: #f56c6c;
  font-weight: 500;
}

.flow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  font-size: 14px;
  color: #606266;
}
</style>
