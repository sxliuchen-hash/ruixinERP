<!--
  ============================================================
  成本管理页（CostList）
  ============================================================
  页面结构：
    顶部：标题 + 筛选（月份/月份区间/类别/关键词）+ 新建记录 + 固定月费生成 + 类别管理
    统计卡片：本月总额 / 环比 / 同比 / 记录数
    图表：12 月趋势（按大类堆叠）+ 按大类饼图
    表格：日期月/类别/大类/金额/摘要/账户/固定月费/创建人/操作
    分页：标准
    弹窗：
      - 新建/编辑成本记录（cost_category_id 从类别树选）
      - 类别管理（admin 可见）
  业务联动：
    - 费用类 payment 自动写 cost_record（后端 paymentService 已联动）
    - 固定月费由 cron 每月 1 日自动生成；admin 也可手动触发
  ============================================================
-->
<template>
  <div class="cost-list-container">
    <!-- ===== 顶部：标题 + 筛选 ===== -->
    <div class="page-header">
      <h3>成本管理</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索摘要/备注"
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
          v-model="filterMonth"
          type="month"
          placeholder="所属月份"
          value-format="YYYY-MM"
          style="width: 160px"
          @change="handleSearch"
        />
        <el-select
          v-model="filterType"
          placeholder="大类"
          clearable
          style="width: 140px"
          @change="handleSearch"
        >
          <el-option
            v-for="(val, key) in COST_CATEGORY_TYPE_MAP"
            :key="key"
            :label="val.label"
            :value="key"
          />
        </el-select>
        <el-select
          v-model="filterRecurring"
          placeholder="来源"
          clearable
          style="width: 120px"
          @change="handleSearch"
        >
          <el-option label="固定月费" :value="1" />
          <el-option label="一次性" :value="0" />
        </el-select>
        <el-button @click="openCategoryDialog" v-if="userStore.isAdmin">
          <el-icon><Setting /></el-icon>类别管理
        </el-button>
        <ExportButton
          path="/export/costs"
          :params="exportParams"
          label="导出"
        />
        <el-button
          type="warning"
          @click="handleGenerateRecurring"
          v-if="userStore.isAdmin"
        >
          <el-icon><Refresh /></el-icon>生成固定月费
        </el-button>
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建记录
        </el-button>
      </div>
    </div>

    <!-- ===== 统计卡片 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">本月成本</div>
            <div class="stat-value text-danger">¥ {{ formatMoney(yoyMom?.current?.total || 0) }}</div>
            <div class="stat-sub">{{ yoyMom?.current?.month || '-' }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">环比（vs 上月）</div>
            <div class="stat-value" :class="getDeltaClass(yoyMom?.prev_month?.delta)">
              {{ formatDelta(yoyMom?.prev_month?.delta_pct) }}
            </div>
            <div class="stat-sub">上月 ¥{{ formatMoney(yoyMom?.prev_month?.total || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">同比（vs 去年同期）</div>
            <div class="stat-value" :class="getDeltaClass(yoyMom?.prev_year?.delta)">
              {{ formatDelta(yoyMom?.prev_year?.delta_pct) }}
            </div>
            <div class="stat-sub">去年 {{ yoyMom?.prev_year?.month }} ¥{{ formatMoney(yoyMom?.prev_year?.total || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计成本（近12月）</div>
            <div class="stat-value text-warning">¥ {{ formatMoney(yearlyTotal) }}</div>
            <div class="stat-sub">{{ monthlySummary.length }} 个月</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 图表区 ===== -->
    <el-row :gutter="16" class="chart-row">
      <el-col :span="16">
        <el-card shadow="never" class="chart-card">
          <template #header>近 12 个月成本趋势（按大类）</template>
          <CostTrendChart :data="monthlySummary" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="chart-card">
          <template #header>成本构成（近 12 月）</template>
          <CostPieChart :data="pieData" />
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 列表 ===== -->
    <el-table :data="recordList" v-loading="loading" border stripe>
      <el-table-column prop="cost_month" label="月份" width="110" align="center" />
      <el-table-column label="类别" width="140">
        <template #default="{ row }">
          {{ row.category_name || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="大类" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" :style="{ color: COST_CATEGORY_TYPE_MAP[row.category_type]?.color }">
            {{ COST_CATEGORY_TYPE_MAP[row.category_type]?.label || '-' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="140" align="right">
        <template #default="{ row }">
          <span class="text-danger">¥ {{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
      <el-table-column label="用户" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.user_id">#{{ row.user_id }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.is_recurring" type="warning" size="small">固定月费</el-tag>
          <el-tag v-else-if="row.payment_id" type="info" size="small">Payment 同步</el-tag>
          <el-tag v-else size="small">手动录入</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            type="primary"
            link
            size="small"
            :disabled="!!row.payment_id"
            @click="handleEdit(row)"
          >编辑</el-button>
          <el-button
            type="danger"
            link
            size="small"
            :disabled="!!row.payment_id"
            @click="handleDelete(row)"
          >删除</el-button>
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

    <!-- ===== 新建/编辑成本记录弹窗 ===== -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑成本记录' : '新建成本记录'"
      width="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="成本类别" prop="category_id">
          <el-cascader
            v-model="formData.category_cascader"
            :options="categoryOptions"
            :props="cascaderProps"
            placeholder="选择类别（从大类到具体类别）"
            style="width: 100%"
            clearable
            @change="handleCategoryCascaderChange"
          />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="金额" prop="amount">
              <el-input-number
                v-model="formData.amount"
                :precision="2"
                :min="0"
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属月份" prop="cost_month">
              <el-date-picker
                v-model="formData.cost_month"
                type="month"
                placeholder="YYYY-MM"
                value-format="YYYY-MM"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="付款账户">
              <AccountSelect v-model="formData.account_id" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="关联用户" prop="user_id">
              <el-input-number
                v-model="formData.user_id"
                :min="1"
                placeholder="用户 ID（人力成本时）"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="固定月费" prop="is_recurring">
          <el-switch
            v-model="formData.is_recurring"
            :active-value="1"
            :inactive-value="0"
            active-text="是"
            inactive-text="否"
          />
          <div class="form-tip">标记为"是"的记录每月 1 日会被 cron 自动复制一份到新月份</div>
        </el-form-item>
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

    <!-- ===== 类别管理抽屉（仅 admin）===== -->
    <el-drawer
      v-model="categoryDrawerVisible"
      title="成本类别管理"
      size="720px"
      destroy-on-close
    >
      <div class="category-manage">
        <div style="margin-bottom: 12px; display: flex; justify-content: flex-end">
          <el-button type="primary" size="small" @click="openCategoryCreate">
            <el-icon><Plus /></el-icon>新建类别
          </el-button>
        </div>
        <el-table :data="categoryList" border size="small">
          <el-table-column label="层级" width="80" align="center">
            <template #default="{ row }">
              <el-tag v-if="!row.parent_id" size="small">一级</el-tag>
              <el-tag v-else type="info" size="small">二级</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column label="大类" width="110" align="center">
            <template #default="{ row }">
              {{ COST_CATEGORY_TYPE_MAP[row.type]?.label || row.type }}
            </template>
          </el-table-column>
          <el-table-column prop="sort_order" label="排序" width="80" align="center" />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
                {{ row.status === 1 ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button type="primary" link size="small" @click="openCategoryEdit(row)">编辑</el-button>
              <el-button type="danger" link size="small" @click="handleCategoryDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <!-- 类别 CRUD 弹窗 -->
    <el-dialog
      v-model="categoryDialogVisible"
      :title="isCatEdit ? '编辑类别' : '新建类别'"
      width="480px"
      destroy-on-close
    >
      <el-form ref="categoryFormRef" :model="categoryForm" :rules="categoryFormRules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="categoryForm.name" maxlength="50" />
        </el-form-item>
        <el-form-item label="大类" prop="type">
          <el-select v-model="categoryForm.type" style="width: 100%">
            <el-option
              v-for="(val, key) in COST_CATEGORY_TYPE_MAP"
              :key="key"
              :label="val.label"
              :value="key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="父类别">
          <el-select v-model="categoryForm.parent_id" clearable placeholder="留空则为一级类别" style="width: 100%">
            <el-option
              v-for="item in topLevelCategories(categoryForm.type)"
              :key="item.id"
              :label="item.name"
              :value="item.id"
              :disabled="item.id === categoryForm.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="categoryForm.sort_order" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="categoryForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="启用"
            inactive-text="停用"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="catSubmitLoading" @click="handleCategorySubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus, Setting, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getCostRecordList,
  createCostRecord,
  updateCostRecord,
  deleteCostRecord,
  getCostCategoryTree,
  getCostCategoryList,
  createCostCategory,
  updateCostCategory,
  deleteCostCategory,
  getCostMonthlySummary,
  getCostYoyMom,
  generateRecurringCosts
} from '@/api/cost'
import { formatMoney } from '@/utils/format'
import { COST_CATEGORY_TYPE_MAP } from '@/utils/constants'
import { useUserStore } from '@/stores/user'
import AccountSelect from '@/components/business/AccountSelect.vue'
import CostTrendChart from './CostTrendChart.vue'
import CostPieChart from '@/components/dashboard/CostPieChart.vue'
import ExportButton from '@/components/common/ExportButton.vue'

const userStore = useUserStore()

// ===== 列表状态 =====
const loading = ref(false)
const recordList = ref([])
const searchKeyword = ref('')
const filterMonth = ref('')
const filterType = ref('')
const filterRecurring = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterMonth.value) p.cost_month = filterMonth.value
  if (filterType.value) p.type = filterType.value
  if (filterRecurring.value !== '') p.is_recurring = filterRecurring.value
  return p
})

// ===== 统计数据 =====
const yoyMom = ref(null)
const monthlySummary = ref([])

// 近 12 月累计
const yearlyTotal = computed(() => {
  return monthlySummary.value.reduce((s, m) => s + (m.total || 0), 0)
})

// 大类饼图数据
const pieData = computed(() => {
  const byType = {}
  monthlySummary.value.forEach(m => {
    Object.entries(m.by_type || {}).forEach(([t, v]) => {
      byType[t] = (byType[t] || 0) + (v || 0)
    })
  })
  return Object.entries(byType).map(([type, value]) => ({
    name: COST_CATEGORY_TYPE_MAP[type]?.label || type,
    value: parseFloat(value.toFixed(2))
  })).filter(x => x.value > 0)
})

// ===== 类别树（cascader 数据源） =====
const categoryTree = ref([])
const categoryList = ref([])

const categoryOptions = computed(() => {
  // 将 tree 转为 cascader 格式：一级大类 > 分类
  return categoryTree.value.map(top => ({
    value: `type:${top.id}`, // 占位，实际选二级
    label: `${COST_CATEGORY_TYPE_MAP[top.type]?.label || top.type} / ${top.name}`,
    disabled: !(top.children && top.children.length), // 没有子类别时禁用（但实际从子类选）
    children: top.children?.map(c => ({ value: c.id, label: c.name })) || [
      { value: top.id, label: `（${top.name}）` }
    ]
  }))
})

const cascaderProps = {
  expandTrigger: 'hover',
  emitPath: true
}

// ===== 记录 CRUD 弹窗 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentRow = ref(null)

const formData = reactive({
  category_id: null,
  category_cascader: [],
  amount: 0,
  cost_month: new Date().toISOString().slice(0, 7),
  user_id: null,
  account_id: null,
  is_recurring: 0,
  summary: '',
  remark: ''
})

const formRules = {
  category_id: [{ required: true, message: '请选择成本类别', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  cost_month: [{ required: true, message: '请选择月份', trigger: 'change' }]
}

function handleCategoryCascaderChange(path) {
  // cascader 末端值就是 category_id（数字）
  if (path && path.length > 0) {
    const last = path[path.length - 1]
    formData.category_id = Number(last)
  } else {
    formData.category_id = null
  }
}

// ===== 类别管理 =====
const categoryDrawerVisible = ref(false)
const categoryDialogVisible = ref(false)
const isCatEdit = ref(false)
const catSubmitLoading = ref(false)
const categoryFormRef = ref(null)
const categoryForm = reactive({
  id: null,
  name: '',
  parent_id: null,
  type: 'operation',
  sort_order: 0,
  status: 1
})
const categoryFormRules = {
  name: [{ required: true, message: '请输入类别名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择大类', trigger: 'change' }]
}

function topLevelCategories(type) {
  // 父类别下拉中只显示同 type 的一级类别
  return categoryList.value.filter(c => !c.parent_id && c.type === type)
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
    if (filterMonth.value) params.cost_month = filterMonth.value
    if (filterType.value) params.type = filterType.value
    if (filterRecurring.value !== '') params.is_recurring = filterRecurring.value

    const res = await getCostRecordList(params)
    recordList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取成本记录失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchStatistics() {
  try {
    const [monthRes, yoyRes] = await Promise.all([
      getCostMonthlySummary({ months: 12 }),
      getCostYoyMom({})
    ])
    monthlySummary.value = monthRes.data || []
    yoyMom.value = yoyRes.data || null
  } catch (e) {
    console.error('获取成本统计失败', e)
  }
}

async function fetchCategories() {
  try {
    const [treeRes, listRes] = await Promise.all([
      getCostCategoryTree(),
      getCostCategoryList({})
    ])
    categoryTree.value = treeRes.data || []
    categoryList.value = listRes.data || []
  } catch (e) {
    console.error('获取类别失败', e)
  }
}

// ===== 交互：记录 =====

function handleSearch() {
  pagination.page = 1
  fetchList()
}

function resetForm() {
  Object.assign(formData, {
    category_id: null,
    category_cascader: [],
    amount: 0,
    cost_month: new Date().toISOString().slice(0, 7),
    user_id: null,
    account_id: null,
    is_recurring: 0,
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
  if (row.payment_id) {
    ElMessage.warning('Payment 自动同步的成本记录请在收付款页面编辑')
    return
  }
  isEdit.value = true
  currentRow.value = row
  // 根据 category_id 找出级联路径
  let cascaderPath = []
  for (const top of categoryTree.value) {
    if (top.id === row.category_id) {
      cascaderPath = [`type:${top.id}`, top.id]
      break
    }
    const child = top.children?.find(c => c.id === row.category_id)
    if (child) {
      cascaderPath = [`type:${top.id}`, child.id]
      break
    }
  }
  Object.assign(formData, {
    category_id: row.category_id,
    category_cascader: cascaderPath,
    amount: parseFloat(row.amount),
    cost_month: row.cost_month,
    user_id: row.user_id || null,
    account_id: row.account_id || null,
    is_recurring: row.is_recurring || 0,
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
    const data = { ...formData }
    delete data.category_cascader
    if (isEdit.value) {
      await updateCostRecord(currentRow.value.id, data)
      ElMessage.success('更新成功')
    } else {
      await createCostRecord(data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchStatistics()
  } catch (e) {
    // 拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

async function handleDelete(row) {
  if (row.payment_id) {
    ElMessage.warning('Payment 自动同步的成本记录请在收付款页面删除')
    return
  }
  try {
    await ElMessageBox.confirm('确定删除该笔成本记录？', '提示', { type: 'warning' })
    await deleteCostRecord(row.id)
    ElMessage.success('已删除')
    fetchList()
    fetchStatistics()
  } catch (e) {
    // 用户取消
  }
}

async function handleGenerateRecurring() {
  try {
    await ElMessageBox.confirm(
      `将为当前月份生成所有 is_recurring=1 的成本记录（若已存在则跳过）。确定继续？`,
      '生成固定月费',
      { type: 'warning' }
    )
    const res = await generateRecurringCosts({})
    ElMessage.success(`已生成 ${res.data?.generated || 0} 条固定月费（${res.data?.month}）`)
    fetchList()
    fetchStatistics()
  } catch (e) {
    // 用户取消
  }
}

// ===== 交互：类别管理 =====

function openCategoryDialog() {
  categoryDrawerVisible.value = true
}

function openCategoryCreate() {
  isCatEdit.value = false
  Object.assign(categoryForm, {
    id: null,
    name: '',
    parent_id: null,
    type: 'operation',
    sort_order: 0,
    status: 1
  })
  categoryDialogVisible.value = true
}

function openCategoryEdit(row) {
  isCatEdit.value = true
  Object.assign(categoryForm, {
    id: row.id,
    name: row.name,
    parent_id: row.parent_id || null,
    type: row.type,
    sort_order: row.sort_order || 0,
    status: row.status
  })
  categoryDialogVisible.value = true
}

async function handleCategorySubmit() {
  const valid = await categoryFormRef.value.validate().catch(() => false)
  if (!valid) return

  catSubmitLoading.value = true
  try {
    const data = { ...categoryForm }
    delete data.id
    if (isCatEdit.value) {
      await updateCostCategory(categoryForm.id, data)
      ElMessage.success('更新成功')
    } else {
      await createCostCategory(data)
      ElMessage.success('创建成功')
    }
    categoryDialogVisible.value = false
    fetchCategories()
  } catch (e) {
    // 拦截器已提示
  } finally {
    catSubmitLoading.value = false
  }
}

async function handleCategoryDelete(row) {
  try {
    await ElMessageBox.confirm(
      '类别有引用时会被拒绝删除。建议改为停用而非删除。',
      '提示',
      { type: 'warning' }
    )
    await deleteCostCategory(row.id)
    ElMessage.success('已删除')
    fetchCategories()
  } catch (e) {
    // 用户取消或后端拒绝
  }
}

// ===== 派生样式 =====

function getDeltaClass(delta) {
  if (delta == null || delta === 0) return ''
  // 成本上涨偏红色，下降偏绿色
  return delta > 0 ? 'text-danger' : 'text-success'
}

function formatDelta(pct) {
  if (pct == null) return '—'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct}%`
}

onMounted(() => {
  fetchCategories()
  fetchList()
  fetchStatistics()
})
</script>

<style scoped lang="scss">
.cost-list-container {
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

.stat-row,
.chart-row {
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  font-size: 12px;
  color: #909399;
}

.chart-card {
  height: 360px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
  margin-top: 4px;
}

.category-manage {
  padding: 0 8px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
