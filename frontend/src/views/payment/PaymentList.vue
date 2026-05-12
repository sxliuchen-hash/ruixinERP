<!--
  ============================================================
  收付款管理页（PaymentList）
  ============================================================
  页面结构：
    顶部：标题 + 搜索 + 筛选（6 维度） + 新建按钮
    Tabs：全部 / 待确认 (x)
    表格：日期/类型/分类/金额/摘要/账户/关联合同/确认状态/操作
    分页：标准分页器
    弹窗：新建/编辑收付款（business/fee 动态切换字段）

  业务规则：
    - 业务类（business）：必须关联合同，type=income → 客户/type=expense → 供应商
    - 费用类（fee）：关联成本类别（当前用 ID 输入，T17 完成后改下拉）
    - 待确认（pending）：企微审批同步来的，点"确认"后才影响合同 paid_amount
    - 数据隔离：agent 角色只看自己创建的记录（后端做）

  待优化项：
    - 成本类别选择器（等 T17 cost_categories CRUD 完成）
    - 关联合同列的跳转（点击 #id 跳到合同详情）
    - 批量操作（选中多条一起确认/删除）
  ============================================================
-->
<template>
  <div class="payment-list-container">
    <!-- ===== 顶部：标题 + 筛选区 ===== -->
    <div class="page-header">
      <h3>收付款管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索摘要/备注/审批单号"
          clearable
          style="width: 240px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterType" placeholder="类型" clearable style="width: 110px" @change="handleSearch">
          <el-option label="收款" value="income" />
          <el-option label="付款" value="expense" />
        </el-select>
        <el-select v-model="filterCategory" placeholder="分类" clearable style="width: 110px" @change="handleSearch">
          <el-option label="业务类" value="business" />
          <el-option label="费用类" value="fee" />
        </el-select>
        <el-select v-model="filterConfirm" placeholder="确认状态" clearable style="width: 120px" @change="handleSearch">
          <el-option label="待确认" value="pending" />
          <el-option label="已确认" value="confirmed" />
        </el-select>
        <AccountSelect v-model="filterAccount" placeholder="账户" style="width: 160px" @update:modelValue="handleSearch" />
        <ExportButton
          path="/export/payments"
          :params="exportParams"
          label="导出"
        />
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建收付款
        </el-button>
      </div>
    </div>

    <!-- ===== Tabs 切换：全部 / 待确认（徽标显示待确认总数） ===== -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange" class="status-tabs">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane :label="`待确认 (${pendingCount})`" name="pending" />
    </el-tabs>

    <!-- ===== 收付款列表 ===== -->
    <el-table :data="paymentList" v-loading="loading" border stripe>
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
      <el-table-column prop="category" label="分类" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.category === 'business' ? '' : 'info'" size="small">
            {{ row.category === 'business' ? '业务' : '费用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="130" align="right">
        <template #default="{ row }">
          <!-- 收入正号绿色 / 支出负号红色 -->
          <span :class="row.type === 'income' ? 'text-success' : 'text-danger'">
            {{ row.type === 'income' ? '+' : '-' }}{{ formatMoney(row.amount) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="summary" label="摘要" min-width="180" show-overflow-tooltip />
      <el-table-column prop="account_id" label="账户" width="140">
        <template #default="{ row }">{{ accountMap[row.account_id] || '-' }}</template>
      </el-table-column>
      <el-table-column prop="contract_id" label="关联合同" width="100" align="center">
        <template #default="{ row }">
          <el-button v-if="row.contract_id" type="primary" link size="small">
            #{{ row.contract_id }}
          </el-button>
          <span v-else>-</span>
        </template>
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
          <!-- 仅 pending 显示确认按钮 -->
          <el-button
            v-if="row.confirm_status === 'pending'"
            type="success"
            link
            size="small"
            @click="handleConfirm(row)"
          >
            确认
          </el-button>
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
      :title="isEdit ? '编辑收付款' : '新建收付款'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <!-- 类型 + 分类（两个单选组合决定后续字段展示） -->
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="类型" prop="type">
              <el-radio-group v-model="formData.type">
                <el-radio value="income">收款</el-radio>
                <el-radio value="expense">付款</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类" prop="category">
              <el-radio-group v-model="formData.category">
                <el-radio value="business">业务类</el-radio>
                <el-radio value="fee">费用类</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 金额 + 日期 -->
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
            <el-form-item label="日期" prop="payment_date">
              <el-date-picker
                v-model="formData.payment_date"
                type="date"
                placeholder="请选择日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 账户 + 支付方式 -->
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="账户" prop="account_id">
              <AccountSelect v-model="formData.account_id" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="支付方式" prop="payment_method">
              <el-select v-model="formData.payment_method" style="width: 100%">
                <el-option label="转账" value="transfer" />
                <el-option label="支票" value="check" />
                <el-option label="现金" value="cash" />
                <el-option label="其他" value="other" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 业务类：关联合同 + 客户/供应商（type 决定显示哪个） -->
        <template v-if="formData.category === 'business'">
          <el-form-item label="关联合同" prop="contract_id">
            <ContractSelect
              v-model="formData.contract_id"
              :type="formData.type === 'income' ? 'sale' : 'purchase'"
            />
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item v-if="formData.type === 'income'" label="客户">
                <CustomerSelect v-model="formData.customer_id" />
              </el-form-item>
              <el-form-item v-else label="供应商">
                <SupplierSelect v-model="formData.supplier_id" />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <!-- 费用类：成本类别（T17 完成后改下拉选择器） -->
        <template v-else>
          <el-form-item label="成本类别" prop="cost_category_id">
            <el-input-number
              v-model="formData.cost_category_id"
              :min="1"
              placeholder="请输入成本类别 ID（后续完善选择器）"
              style="width: 100%"
            />
          </el-form-item>
        </template>

        <el-form-item label="摘要" prop="summary">
          <el-input v-model="formData.summary" placeholder="请输入摘要" maxlength="200" show-word-limit />
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
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getPaymentList,
  createPayment,
  updatePayment,
  deletePayment,
  confirmPayment
} from '@/api/payment'
import { getAccountList } from '@/api/account'
import { formatMoney, formatDate } from '@/utils/format'
import AccountSelect from '@/components/business/AccountSelect.vue'
import ContractSelect from '@/components/business/ContractSelect.vue'
import CustomerSelect from '@/components/business/CustomerSelect.vue'
import SupplierSelect from '@/components/business/SupplierSelect.vue'
import ExportButton from '@/components/common/ExportButton.vue'

// ===== 列表状态 =====
const loading = ref(false)
const paymentList = ref([])
const searchKeyword = ref('')
const filterType = ref('')
const filterCategory = ref('')
const filterConfirm = ref('')
const filterAccount = ref(null)
const activeTab = ref('all')          // 'all' / 'pending'
const pendingCount = ref(0)           // 待确认总数（用于 tab 徽标）
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 账户 id → 名称 映射（表格里展示账户名称）
const accountMap = ref({})

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterType.value) p.type = filterType.value
  if (filterCategory.value) p.category = filterCategory.value
  if (filterAccount.value) p.account_id = filterAccount.value
  if (activeTab.value === 'pending') {
    p.confirm_status = 'pending'
  } else if (filterConfirm.value) {
    p.confirm_status = filterConfirm.value
  }
  return p
})

// ===== 弹窗状态 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentPayment = ref(null)

// 表单数据初始值
const formData = reactive({
  type: 'income',
  category: 'business',
  amount: null,
  payment_date: new Date().toISOString().slice(0, 10), // 默认今日
  payment_method: 'transfer',
  account_id: null,
  contract_id: null,
  customer_id: null,
  supplier_id: null,
  cost_category_id: null,
  summary: '',
  remark: ''
})

// 表单校验规则（业务类必须关联合同的规则用自定义 validator）
const formRules = {
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  payment_date: [{ required: true, message: '请选择日期', trigger: 'change' }],
  account_id: [{ required: true, message: '请选择账户', trigger: 'change' }],
  contract_id: [
    {
      validator: (rule, value, callback) => {
        // 业务类必须关联合同，费用类无要求
        if (formData.category === 'business' && !value) {
          callback(new Error('业务类收付款必须关联合同'))
        } else {
          callback()
        }
      },
      trigger: 'change'
    }
  ]
}

// ===== 数据拉取 =====

/** 拉取账户列表生成 id → name 映射 */
async function fetchAccounts() {
  try {
    const res = await getAccountList({ pageSize: 100 })
    const list = res.data?.list || res.data || []
    const map = {}
    list.forEach(a => { map[a.id] = a.name })
    accountMap.value = map
  } catch (e) {
    console.error('获取账户失败', e)
  }
}

/** 拉取收付款列表（按当前筛选 + tab） */
async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (filterType.value) params.type = filterType.value
    if (filterCategory.value) params.category = filterCategory.value
    if (filterAccount.value) params.account_id = filterAccount.value

    // tab 优先级高于筛选：选中"待确认"时忽略 filterConfirm
    if (activeTab.value === 'pending') {
      params.confirm_status = 'pending'
    } else if (filterConfirm.value) {
      params.confirm_status = filterConfirm.value
    }

    const res = await getPaymentList(params)
    paymentList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取收付款列表失败', e)
  } finally {
    loading.value = false
  }
}

/** 单独查询待确认总数（用于 tab 徽标数字） */
async function fetchPendingCount() {
  try {
    const res = await getPaymentList({ confirm_status: 'pending', pageSize: 1 })
    pendingCount.value = res.data?.pagination?.total || 0
  } catch (e) {
    pendingCount.value = 0
  }
}

// ===== 交互操作 =====

function handleSearch() {
  pagination.page = 1 // 搜索条件变化时回到第 1 页
  fetchList()
}

function handleTabChange() {
  pagination.page = 1
  fetchList()
}

/** 重置表单为初始值（新建前调用） */
function resetForm() {
  Object.assign(formData, {
    type: 'income',
    category: 'business',
    amount: null,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'transfer',
    account_id: null,
    contract_id: null,
    customer_id: null,
    supplier_id: null,
    cost_category_id: null,
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
  currentPayment.value = row
  Object.assign(formData, {
    type: row.type,
    category: row.category,
    amount: parseFloat(row.amount),
    payment_date: row.payment_date,
    payment_method: row.payment_method || 'transfer',
    account_id: row.account_id,
    contract_id: row.contract_id || null,
    customer_id: row.customer_id || null,
    supplier_id: row.supplier_id || null,
    cost_category_id: row.cost_category_id || null,
    summary: row.summary || '',
    remark: row.remark || ''
  })
  dialogVisible.value = true
}

/** 提交表单（新建或编辑） */
async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    const submitData = { ...formData }
    // 清理不相关字段，避免冗余数据入库
    if (submitData.category === 'fee') {
      submitData.contract_id = null
      submitData.customer_id = null
      submitData.supplier_id = null
    } else {
      submitData.cost_category_id = null
      // 业务类：收款清空 supplier，付款清空 customer
      if (submitData.type === 'income') {
        submitData.supplier_id = null
      } else {
        submitData.customer_id = null
      }
    }

    if (isEdit.value) {
      await updatePayment(currentPayment.value.id, submitData)
      ElMessage.success('更新成功')
    } else {
      await createPayment(submitData)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchPendingCount()
  } catch (e) {
    // 错误已由 request.js 拦截器统一提示
  } finally {
    submitLoading.value = false
  }
}

/** 确认单据（pending → confirmed） */
async function handleConfirm(row) {
  try {
    await ElMessageBox.confirm(
      `确认该笔 ¥${formatMoney(row.amount)} 的${row.type === 'income' ? '收款' : '付款'}记录？`,
      '提示',
      { type: 'warning' }
    )
    await confirmPayment(row.id)
    ElMessage.success('已确认')
    fetchList()
    fetchPendingCount()
  } catch (e) {
    // 用户取消
  }
}

/** 删除单据（已确认业务类会联动冲减合同 paid_amount） */
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm('确定删除该笔收付款记录吗？', '提示', { type: 'warning' })
    await deletePayment(row.id)
    ElMessage.success('删除成功')
    fetchList()
    fetchPendingCount()
  } catch (e) {
    // 用户取消
  }
}

// 分类切换时清空不相关字段，避免校验残留
watch(() => formData.category, (val) => {
  if (val === 'fee') {
    formData.contract_id = null
    formData.customer_id = null
    formData.supplier_id = null
  } else {
    formData.cost_category_id = null
  }
})

onMounted(() => {
  fetchAccounts()
  fetchList()
  fetchPendingCount()
})
</script>

<style scoped lang="scss">
.payment-list-container {
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

.status-tabs {
  margin-bottom: 8px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.text-success {
  color: #67c23a;
  font-weight: 500;
}

.text-danger {
  color: #f56c6c;
  font-weight: 500;
}
</style>
