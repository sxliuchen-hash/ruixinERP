<template>
  <div class="supplier-list-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <h3>供应商管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索供应商名称/联系人"
          clearable
          style="width: 240px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建供应商
        </el-button>
      </div>
    </div>

    <!-- 供应商列表表格 -->
    <el-table :data="supplierList" v-loading="loading" border stripe>
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="contact_person" label="联系人" min-width="100" />
      <el-table-column prop="phone" label="电话" min-width="130" />
      <el-table-column prop="bank_name" label="开户行" min-width="140" show-overflow-tooltip />
      <el-table-column prop="tax_rate" label="税点" width="90" align="center">
        <template #default="{ row }">
          {{ row.tax_rate != null ? row.tax_rate + '%' : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="success" link size="small" @click="handleViewSummary(row)">往来账</el-button>
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
      :title="isEdit ? '编辑供应商' : '新建供应商'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
        <el-form-item label="供应商名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入供应商名称" />
        </el-form-item>
        <el-form-item label="联系人" prop="contact_person">
          <el-input v-model="formData.contact_person" placeholder="请输入联系人" />
        </el-form-item>
        <el-form-item label="电话" prop="phone">
          <el-input v-model="formData.phone" placeholder="请输入电话" />
        </el-form-item>
        <el-form-item label="地址" prop="address">
          <el-input v-model="formData.address" placeholder="请输入地址" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>

        <el-divider content-position="left">银行信息</el-divider>

        <el-form-item label="开户行" prop="bank_name">
          <el-input v-model="formData.bank_name" placeholder="请输入开户行" />
        </el-form-item>
        <el-form-item label="银行账号" prop="bank_account">
          <el-input v-model="formData.bank_account" placeholder="请输入银行账号" />
        </el-form-item>
        <el-form-item label="税点" prop="tax_rate">
          <el-input-number
            v-model="formData.tax_rate"
            :precision="2"
            :step="1"
            :min="0"
            :max="100"
            style="width: 100%"
            placeholder="请输入税点"
          >
            <template #suffix>%</template>
          </el-input-number>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 往来账弹窗 -->
    <el-dialog v-model="summaryDialogVisible" title="供应商往来账" width="520px" destroy-on-close>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="供应商名称" :span="2">{{ currentSupplier?.name }}</el-descriptions-item>
        <el-descriptions-item label="合同数">{{ summaryData.contract_count || 0 }}</el-descriptions-item>
        <el-descriptions-item label="合同总额">{{ formatMoney(summaryData.contract_total) }}</el-descriptions-item>
        <el-descriptions-item label="已付金额">
          <span class="text-success">{{ formatMoney(summaryData.paid_amount) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="应付余额">
          <span class="text-danger">{{ formatMoney(summaryData.payable_balance) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getSupplierList,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierSummary
} from '@/api/supplier'
import { formatMoney } from '@/utils/format'

// 列表相关
const loading = ref(false)
const supplierList = ref([])
const searchKeyword = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// CRUD 弹窗
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentSupplier = ref(null)

const formData = reactive({
  name: '',
  contact_person: '',
  phone: '',
  address: '',
  remark: '',
  bank_name: '',
  bank_account: '',
  tax_rate: null
})

const formRules = {
  name: [{ required: true, message: '请输入供应商名称', trigger: 'blur' }]
}

// 往来账弹窗
const summaryDialogVisible = ref(false)
const summaryData = reactive({
  contract_count: 0,
  contract_total: 0,
  paid_amount: 0,
  payable_balance: 0
})

// 获取供应商列表
async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (searchKeyword.value) params.keyword = searchKeyword.value

    const res = await getSupplierList(params)
    supplierList.value = res.data?.list || res.data || []
    pagination.total = res.data?.total || supplierList.value.length
  } catch (error) {
    console.error('获取供应商列表失败:', error)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchList()
}

// 新建供应商
function handleCreate() {
  isEdit.value = false
  Object.assign(formData, {
    name: '',
    contact_person: '',
    phone: '',
    address: '',
    remark: '',
    bank_name: '',
    bank_account: '',
    tax_rate: null
  })
  dialogVisible.value = true
}

// 编辑供应商
function handleEdit(row) {
  isEdit.value = true
  currentSupplier.value = row
  Object.assign(formData, {
    name: row.name,
    contact_person: row.contact_person || '',
    phone: row.phone || '',
    address: row.address || '',
    remark: row.remark || '',
    bank_name: row.bank_name || '',
    bank_account: row.bank_account || '',
    tax_rate: row.tax_rate != null ? row.tax_rate : null
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
      await updateSupplier(currentSupplier.value.id, { ...formData })
      ElMessage.success('编辑成功')
    } else {
      await createSupplier({ ...formData })
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

// 删除供应商
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除供应商「${row.name}」吗？删除后不可恢复。`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await deleteSupplier(row.id)
    ElMessage.success('删除成功')
    fetchList()
  } catch (error) {
    // 用户取消或请求失败
  }
}

// 查看往来账
async function handleViewSummary(row) {
  currentSupplier.value = row
  summaryDialogVisible.value = true
  try {
    const res = await getSupplierSummary(row.id)
    const data = res.data || {}
    Object.assign(summaryData, {
      contract_count: data.contract_count || 0,
      contract_total: data.contract_total || 0,
      paid_amount: data.paid_amount || 0,
      payable_balance: data.payable_balance || 0
    })
  } catch (error) {
    console.error('获取往来账失败:', error)
  }
}

onMounted(() => {
  fetchList()
})
</script>

<style scoped lang="scss">
.supplier-list-container {
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

.text-success {
  color: #67c23a;
  font-weight: 500;
}

.text-danger {
  color: #f56c6c;
  font-weight: 500;
}
</style>
