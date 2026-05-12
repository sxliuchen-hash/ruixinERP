<template>
  <div class="contract-list-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <h3>合同管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索合同编号/标题"
          clearable
          style="width: 220px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterType" placeholder="合同类型" clearable style="width: 120px" @change="handleSearch">
          <el-option label="销售" value="sale" />
          <el-option label="采购" value="purchase" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px" @change="handleSearch">
          <el-option label="待签" value="pending" />
          <el-option label="执行中" value="active" />
          <el-option label="已完成" value="completed" />
          <el-option label="已终止" value="terminated" />
        </el-select>
        <CustomerSelect
          v-model="filterCustomerId"
          placeholder="筛选客户"
          style="width: 160px"
          @update:model-value="handleSearch"
        />
        <ExportButton
          path="/export/contracts"
          :params="exportParams"
          label="导出"
        />
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建合同
        </el-button>
      </div>
    </div>

    <!-- 合同列表表格 -->
    <el-table :data="contractList" v-loading="loading" border stripe>
      <el-table-column prop="contract_no" label="合同编号" min-width="140" />
      <el-table-column prop="type" label="类型" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.type === 'sale' ? 'success' : 'warning'" size="small">
            {{ row.type === 'sale' ? '销售' : '采购' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
      <el-table-column label="客户/供应商" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.customer?.name || row.supplier?.name || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="金额" width="130" align="right">
        <template #default="{ row }">
          <span class="money">{{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="执行进度" width="150" align="center">
        <template #default="{ row }">
          <el-progress
            :percentage="calcProgress(row)"
            :stroke-width="14"
            :text-inside="true"
          />
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="CONTRACT_STATUS_MAP[row.status]?.type || 'info'" size="small">
            {{ CONTRACT_STATUS_MAP[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="sign_date" label="签订日期" width="110" align="center" />
      <el-table-column label="操作" width="240" align="center" fixed="right">
        <template #default="{ row }">
          <router-link :to="`/contracts/${row.id}`" class="action-link">
            <el-button type="primary" link size="small">详情</el-button>
          </router-link>
          <el-button type="warning" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="success" link size="small" @click="handleStatusChange(row)">变更</el-button>
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
      :title="isEdit ? '编辑合同' : '新建合同'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="合同编号" prop="contract_no">
          <el-input v-model="formData.contract_no" placeholder="请输入合同编号" />
        </el-form-item>
        <el-form-item label="合同类型" prop="type">
          <el-radio-group v-model="formData.type" @change="handleTypeChange">
            <el-radio value="sale">销售合同</el-radio>
            <el-radio value="purchase">采购合同</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="合同标题" prop="title">
          <el-input v-model="formData.title" placeholder="请输入合同标题" />
        </el-form-item>
        <el-form-item v-if="formData.type === 'sale'" label="客户" prop="customer_id">
          <CustomerSelect v-model="formData.customer_id" />
        </el-form-item>
        <el-form-item v-if="formData.type === 'purchase'" label="供应商" prop="supplier_id">
          <SupplierSelect v-model="formData.supplier_id" />
        </el-form-item>
        <el-form-item label="合同金额" prop="amount">
          <el-input-number
            v-model="formData.amount"
            :precision="2"
            :step="1000"
            :min="0"
            style="width: 100%"
            placeholder="请输入合同金额"
          />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="签订日期" prop="sign_date">
              <el-date-picker
                v-model="formData.sign_date"
                type="date"
                placeholder="请选择签订日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="到期日期" prop="expire_date">
              <el-date-picker
                v-model="formData.expire_date"
                type="date"
                placeholder="请选择到期日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="3" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 状态变更弹窗 -->
    <el-dialog v-model="statusDialogVisible" title="合同状态变更" width="420px" destroy-on-close>
      <el-form ref="statusFormRef" :model="statusForm" :rules="statusRules" label-width="90px">
        <el-form-item label="当前状态">
          <el-tag :type="CONTRACT_STATUS_MAP[currentContract?.status]?.type || 'info'">
            {{ CONTRACT_STATUS_MAP[currentContract?.status]?.label || currentContract?.status }}
          </el-tag>
        </el-form-item>
        <el-form-item label="新状态" prop="status">
          <el-select v-model="statusForm.status" placeholder="请选择新状态" style="width: 100%">
            <el-option
              v-for="(item, key) in CONTRACT_STATUS_MAP"
              :key="key"
              :label="item.label"
              :value="key"
              :disabled="key === currentContract?.status"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleStatusSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getContractList,
  createContract,
  updateContract,
  deleteContract,
  updateContractStatus
} from '@/api/contract'
import { formatMoney } from '@/utils/format'
import { CONTRACT_STATUS_MAP } from '@/utils/constants'
import CustomerSelect from '@/components/business/CustomerSelect.vue'
import SupplierSelect from '@/components/business/SupplierSelect.vue'
import ExportButton from '@/components/common/ExportButton.vue'

// 列表相关
const loading = ref(false)
const contractList = ref([])
const searchKeyword = ref('')
const filterType = ref('')
const filterStatus = ref('')
const filterCustomerId = ref(null)
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterType.value) p.type = filterType.value
  if (filterStatus.value) p.status = filterStatus.value
  if (filterCustomerId.value) p.customer_id = filterCustomerId.value
  return p
})

// CRUD 弹窗
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentContract = ref(null)

const formData = reactive({
  contract_no: '',
  type: 'sale',
  title: '',
  customer_id: null,
  supplier_id: null,
  amount: null,
  sign_date: '',
  expire_date: '',
  remark: ''
})

const formRules = {
  contract_no: [{ required: true, message: '请输入合同编号', trigger: 'blur' }],
  type: [{ required: true, message: '请选择合同类型', trigger: 'change' }],
  title: [{ required: true, message: '请输入合同标题', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入合同金额', trigger: 'blur' }],
  customer_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  supplier_id: [{ required: true, message: '请选择供应商', trigger: 'change' }]
}

// 状态变更弹窗
const statusDialogVisible = ref(false)
const statusFormRef = ref(null)
const statusForm = reactive({ status: '' })
const statusRules = {
  status: [{ required: true, message: '请选择新状态', trigger: 'change' }]
}

// 计算执行进度
function calcProgress(row) {
  if (!row.amount || row.amount === 0) return 0
  const paid = row.paid_amount || 0
  const percent = Math.round((paid / row.amount) * 100)
  return Math.min(percent, 100)
}

// 获取合同列表
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
    if (filterCustomerId.value) params.customer_id = filterCustomerId.value

    const res = await getContractList(params)
    contractList.value = res.data?.list || res.data || []
    pagination.total = res.data?.total || contractList.value.length
  } catch (error) {
    console.error('获取合同列表失败:', error)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchList()
}

// 合同类型切换时清除不相关的选择
function handleTypeChange() {
  if (formData.type === 'sale') {
    formData.supplier_id = null
  } else {
    formData.customer_id = null
  }
}

// 新建合同
function handleCreate() {
  isEdit.value = false
  Object.assign(formData, {
    contract_no: '',
    type: 'sale',
    title: '',
    customer_id: null,
    supplier_id: null,
    amount: null,
    sign_date: '',
    expire_date: '',
    remark: ''
  })
  dialogVisible.value = true
}

// 编辑合同
function handleEdit(row) {
  isEdit.value = true
  currentContract.value = row
  Object.assign(formData, {
    contract_no: row.contract_no,
    type: row.type,
    title: row.title,
    customer_id: row.customer_id || null,
    supplier_id: row.supplier_id || null,
    amount: row.amount,
    sign_date: row.sign_date || '',
    expire_date: row.expire_date || '',
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
    const submitData = { ...formData }
    // 根据类型清除不相关的字段
    if (submitData.type === 'sale') {
      submitData.supplier_id = null
    } else {
      submitData.customer_id = null
    }

    if (isEdit.value) {
      await updateContract(currentContract.value.id, submitData)
      ElMessage.success('编辑成功')
    } else {
      await createContract(submitData)
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

// 状态变更
function handleStatusChange(row) {
  currentContract.value = row
  statusForm.status = ''
  statusDialogVisible.value = true
}

async function handleStatusSubmit() {
  const valid = await statusFormRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await updateContractStatus(currentContract.value.id, { status: statusForm.status })
    ElMessage.success('状态变更成功')
    statusDialogVisible.value = false
    fetchList()
  } catch (error) {
    // 错误已由拦截器处理
  } finally {
    submitLoading.value = false
  }
}

// 删除合同
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除合同「${row.title}」吗？此操作不可恢复。`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await deleteContract(row.id)
    ElMessage.success('删除成功')
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

onMounted(() => {
  fetchList()
})
</script>

<style scoped lang="scss">
.contract-list-container {
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
}

.action-link {
  text-decoration: none;
}
</style>
