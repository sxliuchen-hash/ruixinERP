<template>
  <div class="invoice-list-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <h3>发票管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索发票号/备注"
          clearable
          style="width: 200px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterType" placeholder="发票方向" clearable style="width: 120px" @change="handleSearch">
          <el-option label="销项（开票）" value="output" />
          <el-option label="进项（收票）" value="input" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px" @change="handleSearch">
          <el-option label="待开票" value="pending" />
          <el-option label="已开票" value="issued" />
          <el-option label="已作废" value="cancelled" />
        </el-select>
        <ContractSelect
          v-model="filterContractId"
          placeholder="筛选合同"
          style="width: 200px"
          @update:model-value="handleSearch"
        />
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建发票
        </el-button>
      </div>
    </div>

    <!-- 发票列表表格 -->
    <el-table :data="invoiceList" v-loading="loading" border stripe>
      <el-table-column prop="invoice_no" label="发票号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="type" label="方向" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.type === 'output' ? 'success' : 'warning'" size="small">
            {{ row.type === 'output' ? '销项' : '进项' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="invoice_type" label="票种" width="80" align="center">
        <template #default="{ row }">
          {{ row.invoice_type === 'special' ? '专票' : '普票' }}
        </template>
      </el-table-column>
      <el-table-column label="客户/供应商" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.type === 'output'">{{ row.customer?.name || row.customer_name || '-' }}</span>
          <span v-else>{{ row.supplier?.name || row.supplier_name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="金额(不含税)" width="120" align="right">
        <template #default="{ row }">
          <span class="money">{{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="税额" width="110" align="right">
        <template #default="{ row }">
          <span class="money">{{ formatMoney(row.tax_amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="价税合计" width="130" align="right">
        <template #default="{ row }">
          <span class="money total">{{ formatMoney(row.total_amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="invoice_date" label="开票日期" width="110" align="center">
        <template #default="{ row }">
          {{ formatDate(row.invoice_date) }}
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button
            v-if="row.status === 'pending'"
            type="success"
            link
            size="small"
            @click="handleMarkIssued(row)"
          >开票</el-button>
          <el-button
            v-if="row.status === 'issued'"
            type="warning"
            link
            size="small"
            @click="handleMarkCancelled(row)"
          >作废</el-button>
          <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
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
      :title="isEdit ? '编辑发票' : '新建发票'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="发票方向" prop="type">
          <el-radio-group v-model="formData.type" @change="handleTypeChange">
            <el-radio value="output">销项（开票）</el-radio>
            <el-radio value="input">进项（收票）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="票种" prop="invoice_type">
          <el-radio-group v-model="formData.invoice_type">
            <el-radio value="normal">普票</el-radio>
            <el-radio value="special">专票</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发票号" prop="invoice_no">
          <el-input v-model="formData.invoice_no" placeholder="请输入发票号" />
        </el-form-item>
        <el-form-item label="关联合同" prop="contract_id">
          <ContractSelect
            v-model="formData.contract_id"
            :type="formData.type === 'output' ? 'sale' : 'purchase'"
          />
        </el-form-item>
        <!-- 销项发票：选择客户 -->
        <el-form-item v-if="formData.type === 'output'" label="客户" prop="customer_id">
          <CustomerSelect v-model="formData.customer_id" />
        </el-form-item>
        <!-- 进项发票：选择供应商 -->
        <el-form-item v-if="formData.type === 'input'" label="供应商" prop="supplier_id">
          <SupplierSelect
            v-model="formData.supplier_id"
            @update:model-value="handleSupplierChange"
          />
        </el-form-item>
        <el-form-item label="金额(不含税)" prop="amount">
          <el-input-number
            v-model="formData.amount"
            :precision="2"
            :step="100"
            :min="0"
            style="width: 100%"
            placeholder="不含税金额"
            @change="handleAmountChange"
          />
        </el-form-item>
        <el-form-item label="税额" prop="tax_amount">
          <el-input-number
            v-model="formData.tax_amount"
            :precision="2"
            :step="10"
            :min="0"
            style="width: 100%"
            placeholder="税额"
          />
          <div v-if="formData.type === 'input' && selectedSupplierTaxRate" class="tax-hint">
            供应商税率 {{ selectedSupplierTaxRate }}%，已自动计算税额
          </div>
        </el-form-item>
        <el-form-item label="价税合计">
          <el-input :model-value="computedTotalAmount" disabled placeholder="自动计算 = 金额 + 税额" />
        </el-form-item>
        <el-form-item label="开票日期" prop="invoice_date">
          <el-date-picker
            v-model="formData.invoice_date"
            type="date"
            placeholder="请选择开票日期"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getInvoiceList,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  updateInvoiceStatus
} from '@/api/invoice'
import { getActiveSuppliers } from '@/api/supplier'
import { formatMoney, formatDate } from '@/utils/format'
import { INVOICE_STATUS_MAP } from '@/utils/constants'
import ContractSelect from '@/components/business/ContractSelect.vue'
import CustomerSelect from '@/components/business/CustomerSelect.vue'
import SupplierSelect from '@/components/business/SupplierSelect.vue'

// 列表相关
const loading = ref(false)
const invoiceList = ref([])
const searchKeyword = ref('')
const filterType = ref('')
const filterStatus = ref('')
const filterContractId = ref(null)
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// CRUD 弹窗
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentInvoice = ref(null)

// 供应商列表（用于获取税率）
const suppliersList = ref([])
const selectedSupplierTaxRate = ref(null)

const formData = reactive({
  type: 'output',
  invoice_type: 'normal',
  invoice_no: '',
  contract_id: null,
  customer_id: null,
  supplier_id: null,
  amount: null,
  tax_amount: null,
  invoice_date: '',
  remark: ''
})

const formRules = {
  type: [{ required: true, message: '请选择发票方向', trigger: 'change' }],
  invoice_type: [{ required: true, message: '请选择票种', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  invoice_date: [{ required: true, message: '请选择开票日期', trigger: 'change' }]
}

// 计算价税合计
const computedTotalAmount = computed(() => {
  const amount = Number(formData.amount) || 0
  const taxAmount = Number(formData.tax_amount) || 0
  return formatMoney(amount + taxAmount)
})

// 状态标签
function statusLabel(status) {
  const map = { pending: '待开票', issued: '已开票', cancelled: '已作废' }
  return map[status] || status
}

function statusTagType(status) {
  const map = { pending: 'warning', issued: 'success', cancelled: 'info' }
  return map[status] || 'info'
}

// 获取发票列表
async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (filterType.value) params.type = filterType.value
    if (filterStatus.value) params.status = filterStatus.value
    if (filterContractId.value) params.contract_id = filterContractId.value

    const res = await getInvoiceList(params)
    invoiceList.value = res.data?.list || res.data || []
    pagination.total = res.data?.total || invoiceList.value.length
  } catch (error) {
    console.error('获取发票列表失败:', error)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchList()
}

// 加载供应商列表（用于获取税率）
async function fetchSuppliers() {
  try {
    const res = await getActiveSuppliers()
    suppliersList.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取供应商列表失败:', error)
  }
}

// 发票方向切换时清除不相关字段
function handleTypeChange() {
  if (formData.type === 'output') {
    formData.supplier_id = null
    selectedSupplierTaxRate.value = null
  } else {
    formData.customer_id = null
  }
  formData.contract_id = null
}

// 供应商变更时自动计算税额
function handleSupplierChange(supplierId) {
  if (!supplierId || formData.type !== 'input') {
    selectedSupplierTaxRate.value = null
    return
  }
  const supplier = suppliersList.value.find(s => s.id === supplierId)
  if (supplier && supplier.tax_rate) {
    selectedSupplierTaxRate.value = Number(supplier.tax_rate)
    autoCalculateTax()
  } else {
    selectedSupplierTaxRate.value = null
  }
}

// 金额变更时自动计算税额（仅进项发票且已选供应商）
function handleAmountChange() {
  if (formData.type === 'input' && selectedSupplierTaxRate.value) {
    autoCalculateTax()
  }
}

// 根据供应商税率自动计算税额
function autoCalculateTax() {
  if (selectedSupplierTaxRate.value && formData.amount) {
    const rate = selectedSupplierTaxRate.value / 100
    formData.tax_amount = Math.round(formData.amount * rate * 100) / 100
  }
}

// 新建发票
function handleCreate() {
  isEdit.value = false
  selectedSupplierTaxRate.value = null
  Object.assign(formData, {
    type: 'output',
    invoice_type: 'normal',
    invoice_no: '',
    contract_id: null,
    customer_id: null,
    supplier_id: null,
    amount: null,
    tax_amount: null,
    invoice_date: '',
    remark: ''
  })
  dialogVisible.value = true
}

// 编辑发票
function handleEdit(row) {
  isEdit.value = true
  currentInvoice.value = row
  Object.assign(formData, {
    type: row.type || 'output',
    invoice_type: row.invoice_type || 'normal',
    invoice_no: row.invoice_no || '',
    contract_id: row.contract_id || null,
    customer_id: row.customer_id || null,
    supplier_id: row.supplier_id || null,
    amount: row.amount || null,
    tax_amount: row.tax_amount || null,
    invoice_date: row.invoice_date || '',
    remark: row.remark || ''
  })
  // 如果是进项发票且有供应商，加载税率
  if (row.type === 'input' && row.supplier_id) {
    const supplier = suppliersList.value.find(s => s.id === row.supplier_id)
    selectedSupplierTaxRate.value = supplier?.tax_rate ? Number(supplier.tax_rate) : null
  } else {
    selectedSupplierTaxRate.value = null
  }
  dialogVisible.value = true
}

// 提交表单
async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    const submitData = { ...formData }
    // 计算价税合计
    submitData.total_amount = (Number(submitData.amount) || 0) + (Number(submitData.tax_amount) || 0)
    // 根据类型清除不相关的字段
    if (submitData.type === 'output') {
      submitData.supplier_id = null
    } else {
      submitData.customer_id = null
    }

    if (isEdit.value) {
      await updateInvoice(currentInvoice.value.id, submitData)
      ElMessage.success('编辑成功')
    } else {
      await createInvoice(submitData)
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

// 状态变更：待开票 → 已开票
async function handleMarkIssued(row) {
  try {
    await ElMessageBox.confirm(
      `确认将发票「${row.invoice_no || '未编号'}」标记为已开票？`,
      '确认开票',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'info' }
    )
    await updateInvoiceStatus(row.id, { status: 'issued' })
    ElMessage.success('已标记为已开票')
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

// 状态变更：已开票 → 已作废
async function handleMarkCancelled(row) {
  try {
    await ElMessageBox.confirm(
      `确认将发票「${row.invoice_no || '未编号'}」作废？此操作不可撤销。`,
      '确认作废',
      { confirmButtonText: '确认作废', cancelButtonText: '取消', type: 'warning' }
    )
    await updateInvoiceStatus(row.id, { status: 'cancelled' })
    ElMessage.success('发票已作废')
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

// 删除发票
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除发票「${row.invoice_no || '未编号'}」吗？此操作不可恢复。`,
      '提示',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )
    await deleteInvoice(row.id)
    ElMessage.success('删除成功')
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

onMounted(() => {
  fetchList()
  fetchSuppliers()
})
</script>

<style scoped lang="scss">
.invoice-list-container {
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
  flex-wrap: wrap;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.money {
  font-weight: 500;
  color: #303133;

  &.total {
    color: #e6a23c;
    font-weight: 600;
  }
}

.tax-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
