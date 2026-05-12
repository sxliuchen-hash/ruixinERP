<!--
  ============================================================
  交易项目列表页（ProjectList）
  ============================================================
  页面结构：
    顶部：标题 + 筛选（关键词/状态/客户/供应商/排序） + 新建按钮
    统计卡片：总数 / 进行中 / 已完成 / 累计销售 / 累计利润 / 已完成项目利润
    表格：名称/专利/客户/供应商/销售/采购/税点/维持/毛利/状态/操作
    分页：标准
    弹窗：新建/编辑
  业务联动：
    - 聚合字段来自 /projects/summary，展示项目利润汇总
    - 列表中"刷新"按钮调用 POST /:id/refresh 重算单个项目
    - 点击项目名跳 /projects/:id 详情页
  ============================================================
-->
<template>
  <div class="project-list-container">
    <!-- ===== 顶部筛选 ===== -->
    <div class="page-header">
      <h3>交易项目</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索名称/专利号/备注"
          clearable
          style="width: 240px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="filterStatus"
          placeholder="状态"
          clearable
          style="width: 120px"
          @change="handleSearch"
        >
          <el-option
            v-for="(val, key) in PROJECT_STATUS_MAP"
            :key="key"
            :label="val.label"
            :value="key"
          />
        </el-select>
        <CustomerSelect v-model="filterCustomer" placeholder="客户" style="width: 180px" @update:modelValue="handleSearch" />
        <SupplierSelect v-model="filterSupplier" placeholder="供应商" style="width: 180px" @update:modelValue="handleSearch" />
        <el-select
          v-model="sortField"
          placeholder="排序"
          clearable
          style="width: 120px"
          @change="handleSearch"
        >
          <el-option label="默认" value="" />
          <el-option label="利润" value="profit" />
          <el-option label="销售额" value="sale" />
        </el-select>
        <ExportButton
          path="/export/projects"
          :params="exportParams"
          label="导出"
        />
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建项目
        </el-button>
      </div>
    </div>

    <!-- ===== 统计卡片 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">项目总数</div>
            <div class="stat-value">{{ summary?.all?.count || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">已完成</div>
            <div class="stat-value text-success">{{ summary?.completed?.count || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计销售</div>
            <div class="stat-value text-primary">¥ {{ formatMoney(summary?.all?.sale_amount || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计采购</div>
            <div class="stat-value text-warning">¥ {{ formatMoney(summary?.all?.purchase_amount || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计毛利</div>
            <div
              class="stat-value"
              :class="(summary?.all?.gross_profit || 0) >= 0 ? 'text-success' : 'text-danger'"
            >
              ¥ {{ formatMoney(summary?.all?.gross_profit || 0) }}
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">已兑现利润</div>
            <div
              class="stat-value"
              :class="(summary?.completed?.gross_profit || 0) >= 0 ? 'text-success' : 'text-danger'"
            >
              ¥ {{ formatMoney(summary?.completed?.gross_profit || 0) }}
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 列表 ===== -->
    <el-table :data="projectList" v-loading="loading" border stripe>
      <el-table-column label="项目名称" min-width="200" fixed="left">
        <template #default="{ row }">
          <el-button type="primary" link @click="handleView(row)">{{ row.name }}</el-button>
          <div class="sub-info" v-if="row.patent_no">专利 {{ row.patent_no }}</div>
        </template>
      </el-table-column>
      <el-table-column label="客户" width="140">
        <template #default="{ row }">{{ row.customer?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="供应商" width="140">
        <template #default="{ row }">{{ row.supplier?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="销售收入" width="120" align="right">
        <template #default="{ row }">
          <span class="text-primary">¥ {{ formatMoney(row.sale_amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="采购" width="120" align="right">
        <template #default="{ row }">¥ {{ formatMoney(row.purchase_amount) }}</template>
      </el-table-column>
      <el-table-column label="税点" width="100" align="right">
        <template #default="{ row }">¥ {{ formatMoney(row.tax_cost) }}</template>
      </el-table-column>
      <el-table-column label="维持" width="100" align="right">
        <template #default="{ row }">¥ {{ formatMoney(row.maintain_cost) }}</template>
      </el-table-column>
      <el-table-column label="毛利润" width="130" align="right">
        <template #default="{ row }">
          <span :class="row.gross_profit >= 0 ? 'text-success' : 'text-danger'">
            ¥ {{ formatMoney(row.gross_profit) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="PROJECT_STATUS_MAP[row.status]?.type" size="small">
            {{ PROJECT_STATUS_MAP[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleView(row)">详情</el-button>
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="success" link size="small" @click="handleRefresh(row)">刷新</el-button>
          <el-dropdown trigger="click" @command="cmd => handleStatusCommand(row, cmd)">
            <el-button type="warning" link size="small">
              状态<el-icon><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="active" :disabled="row.status === 'active'">
                  恢复进行中
                </el-dropdown-item>
                <el-dropdown-item command="completed" :disabled="row.status === 'completed'">
                  标记完成
                </el-dropdown-item>
                <el-dropdown-item command="cancelled" :disabled="row.status === 'cancelled'">
                  取消
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
      :title="isEdit ? '编辑项目' : '新建项目'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入项目名称" maxlength="200" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="主专利号" prop="patent_no">
              <el-input v-model="formData.patent_no" placeholder="例如 CN2023..." maxlength="50" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="formData.status" style="width: 100%">
                <el-option
                  v-for="(val, key) in PROJECT_STATUS_MAP"
                  :key="key"
                  :label="val.label"
                  :value="key"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="客户">
              <CustomerSelect v-model="formData.customer_id" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="供应商">
              <SupplierSelect v-model="formData.supplier_id" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="负责人" prop="owner_id">
          <el-input-number
            v-model="formData.owner_id"
            :min="1"
            placeholder="负责人用户 ID（T21 主项目用户接口就绪后改下拉）"
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
import { useRouter } from 'vue-router'
import { Search, Plus, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getProjectList,
  getProjectSummary,
  createProject,
  updateProject,
  deleteProject,
  changeProjectStatus,
  refreshProject
} from '@/api/project'
import { formatMoney } from '@/utils/format'
import { PROJECT_STATUS_MAP } from '@/utils/constants'
import CustomerSelect from '@/components/business/CustomerSelect.vue'
import SupplierSelect from '@/components/business/SupplierSelect.vue'
import ExportButton from '@/components/common/ExportButton.vue'

const router = useRouter()

// ===== 列表状态 =====
const loading = ref(false)
const projectList = ref([])
const searchKeyword = ref('')
const filterStatus = ref('')
const filterCustomer = ref(null)
const filterSupplier = ref(null)
const sortField = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 汇总统计
const summary = ref(null)

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterStatus.value) p.status = filterStatus.value
  if (filterCustomer.value) p.customer_id = filterCustomer.value
  if (filterSupplier.value) p.supplier_id = filterSupplier.value
  if (sortField.value) {
    p.sort = sortField.value
    p.order = 'desc'
  }
  return p
})

// ===== 弹窗状态 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentRow = ref(null)

const formData = reactive({
  name: '',
  patent_no: '',
  customer_id: null,
  supplier_id: null,
  status: 'active',
  owner_id: null,
  remark: ''
})

const formRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }]
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
    if (filterStatus.value) params.status = filterStatus.value
    if (filterCustomer.value) params.customer_id = filterCustomer.value
    if (filterSupplier.value) params.supplier_id = filterSupplier.value
    if (sortField.value) {
      params.sort = sortField.value
      params.order = 'desc'
    }

    const res = await getProjectList(params)
    projectList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取项目列表失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchSummary() {
  try {
    const res = await getProjectSummary({})
    summary.value = res.data || null
  } catch (e) {
    console.error('获取项目汇总失败', e)
  }
}

// ===== 交互 =====

function handleSearch() {
  pagination.page = 1
  fetchList()
}

function resetForm() {
  Object.assign(formData, {
    name: '',
    patent_no: '',
    customer_id: null,
    supplier_id: null,
    status: 'active',
    owner_id: null,
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
  currentRow.value = row
  Object.assign(formData, {
    name: row.name,
    patent_no: row.patent_no || '',
    customer_id: row.customer_id || null,
    supplier_id: row.supplier_id || null,
    status: row.status,
    owner_id: row.owner_id || null,
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
    if (isEdit.value) {
      delete data.status // 状态走专用接口
      await updateProject(currentRow.value.id, data)
      ElMessage.success('更新成功')
    } else {
      await createProject(data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchSummary()
  } catch (e) {
    // 拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

function handleView(row) {
  router.push(`/projects/${row.id}`)
}

async function handleRefresh(row) {
  try {
    await refreshProject(row.id)
    ElMessage.success('聚合数据已刷新')
    fetchList()
    fetchSummary()
  } catch (e) {
    // 拦截器已提示
  }
}

async function handleStatusCommand(row, command) {
  const label = PROJECT_STATUS_MAP[command]?.label || command
  try {
    await ElMessageBox.confirm(`确定将项目状态变更为"${label}"？`, '提示', { type: 'warning' })
    await changeProjectStatus(row.id, command)
    ElMessage.success('状态变更成功')
    fetchList()
    fetchSummary()
  } catch (e) {
    // 用户取消
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      '删除项目将解除与合同/收付款/专利库存的关联（原始单据保留），确定继续？',
      '提示',
      { type: 'warning' }
    )
    await deleteProject(row.id)
    ElMessage.success('已删除')
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
.project-list-container {
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
  gap: 6px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.sub-info {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
