<!--
  ============================================================
  专利库存管理页（InventoryList）
  ============================================================
  页面结构：
    顶部：标题 + 筛选（关键词/状态/领域/库龄/排序） + 入库/批量调价/到期预警按钮
    统计卡片：总数 / 在库数 / 在库现价总和 / 预估利润 / 累计维持成本 / 平均库龄
    表格：专利号/名称/类型/领域/采购价/现价/维持成本/利润预估/库龄/状态/操作
    分页：标准
    弹窗：入库/编辑 / 调价 / 批量调价
    抽屉：即将到期（60 天内）
  业务联动：
    - 调价 → 事务写入 price_history
    - 删除 → 级联删除年费和调价历史
    - 点击"详情"跳转 /inventory/:id，年费+调价历史在详情页管理
  ============================================================
-->
<template>
  <div class="inventory-list-container">
    <!-- ===== 顶部：标题 + 筛选 ===== -->
    <div class="page-header">
      <h3>专利库存</h3>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索专利号/名称/备注"
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
            v-for="(val, key) in INVENTORY_STATUS_MAP"
            :key="key"
            :label="val.label"
            :value="key"
          />
        </el-select>
        <el-input
          v-model="filterTechField"
          placeholder="技术领域"
          clearable
          style="width: 140px"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <el-input-number
          v-model="filterMinAge"
          :min="0"
          placeholder="库龄≥"
          controls-position="right"
          style="width: 110px"
          @change="handleSearch"
        />
        <el-input-number
          v-model="filterMaxAge"
          :min="0"
          placeholder="库龄≤"
          controls-position="right"
          style="width: 110px"
          @change="handleSearch"
        />
        <el-select
          v-model="sortField"
          placeholder="排序"
          clearable
          style="width: 120px"
          @change="handleSearch"
        >
          <el-option label="默认" value="" />
          <el-option label="库龄" value="age" />
          <el-option label="利润" value="profit" />
          <el-option label="现价" value="price" />
          <el-option label="到期日" value="deadline" />
        </el-select>
        <el-button type="warning" @click="openExpiringDrawer">
          <el-icon><Bell /></el-icon>到期预警
        </el-button>
        <ExportButton
          path="/export/inventory"
          :params="exportParams"
          label="导出"
        />
        <el-button type="success" @click="openBatchPriceDialog">
          <el-icon><Money /></el-icon>批量调价
        </el-button>
        <el-dropdown trigger="click" @command="handleCreateCommand">
          <el-button type="primary">
            <el-icon><Plus /></el-icon>入库<el-icon style="margin-left: 4px"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="single">单个入库</el-dropdown-item>
              <el-dropdown-item command="batch">批量入库（Excel）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- ===== 统计卡片 ===== -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">库存总数</div>
            <div class="stat-value">{{ overview?.total_count || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">在库</div>
            <div class="stat-value text-success">{{ overview?.stock_count || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">在库现价</div>
            <div class="stat-value text-primary">¥ {{ formatMoney(overview?.total_value || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">预估利润</div>
            <div class="stat-value text-warning">¥ {{ formatMoney(overview?.estimate_profit || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计维持成本</div>
            <div class="stat-value text-danger">¥ {{ formatMoney(overview?.total_maintain || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">平均库龄</div>
            <div class="stat-value">
              {{ overview?.avg_stock_age || 0 }}<span class="stat-sub">天</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 列表 ===== -->
    <el-table :data="inventoryList" v-loading="loading" border stripe>
      <el-table-column prop="patent_no" label="专利号" width="150" fixed="left" />
      <el-table-column prop="patent_name" label="名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="patent_type" label="类型" width="100" align="center">
        <template #default="{ row }">{{ row.patent_type || '-' }}</template>
      </el-table-column>
      <el-table-column prop="tech_field" label="领域" width="120">
        <template #default="{ row }">{{ row.tech_field || '-' }}</template>
      </el-table-column>
      <el-table-column label="采购价" width="110" align="right">
        <template #default="{ row }">¥ {{ formatMoney(row.purchase_price) }}</template>
      </el-table-column>
      <el-table-column label="现价" width="110" align="right">
        <template #default="{ row }">
          <span class="text-primary">¥ {{ formatMoney(row.current_price) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="维持成本" width="110" align="right">
        <template #default="{ row }">
          <span class="text-danger">¥ {{ formatMoney(row.total_maintain_cost) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="利润预估" width="120" align="right">
        <template #default="{ row }">
          <span :class="row.estimate_profit >= 0 ? 'text-success' : 'text-danger'">
            ¥ {{ formatMoney(row.estimate_profit) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="库龄" width="90" align="center">
        <template #default="{ row }">
          <span v-if="row.stock_age_days !== null">{{ row.stock_age_days }}天</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="下次年费" width="110" align="center">
        <template #default="{ row }">
          <span :class="getDeadlineClass(row.next_fee_deadline)">
            {{ formatDate(row.next_fee_deadline) || '-' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="INVENTORY_STATUS_MAP[row.status]?.type" size="small">
            {{ INVENTORY_STATUS_MAP[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleView(row)">详情</el-button>
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="success" link size="small" @click="handlePriceChange(row)">调价</el-button>
          <el-dropdown trigger="click" @command="cmd => handleStatusCommand(row, cmd)">
            <el-button type="warning" link size="small">
              状态<el-icon><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="in_stock" :disabled="row.status === 'in_stock'">
                  回库
                </el-dropdown-item>
                <el-dropdown-item command="sold" :disabled="row.status === 'sold'">
                  标记售出
                </el-dropdown-item>
                <el-dropdown-item command="transferring" :disabled="row.status === 'transferring'">
                  转让中
                </el-dropdown-item>
                <el-dropdown-item command="abandoned" :disabled="row.status === 'abandoned'">
                  放弃
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

    <!-- ===== 入库/编辑弹窗 ===== -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑库存' : '专利入库'"
      width="720px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="110px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="专利号" prop="patent_no">
              <el-input v-model="formData.patent_no" placeholder="例如 CN202310000000.1" maxlength="50" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="专利类型" prop="patent_type">
              <el-select v-model="formData.patent_type" placeholder="请选择" style="width: 100%">
                <el-option label="发明" value="发明" />
                <el-option label="实用新型" value="实用新型" />
                <el-option label="外观" value="外观" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="专利名称" prop="patent_name">
          <el-input
            v-model="formData.patent_name"
            placeholder="请输入专利名称"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="技术领域" prop="tech_field">
              <el-input v-model="formData.tech_field" placeholder="例如 通信/新材料" maxlength="100" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="formData.status" style="width: 100%">
                <el-option
                  v-for="(val, key) in INVENTORY_STATUS_MAP"
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
            <el-form-item label="采购价格" prop="purchase_price">
              <el-input-number
                v-model="formData.purchase_price"
                :precision="2"
                :min="0"
                :step="1000"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="当前售价" prop="current_price">
              <el-input-number
                v-model="formData.current_price"
                :precision="2"
                :min="0"
                :step="1000"
                :disabled="isEdit"
                style="width: 100%"
              />
              <div v-if="isEdit" class="form-tip">编辑时请通过"调价"功能修改，以留存历史</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="采购日期" prop="purchase_date">
              <el-date-picker
                v-model="formData.purchase_date"
                type="date"
                placeholder="请选择"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入库日期" prop="stock_in_date">
              <el-date-picker
                v-model="formData.stock_in_date"
                type="date"
                placeholder="请选择"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="供应商">
              <SupplierSelect v-model="formData.supplier_id" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="采购合同">
              <ContractSelect v-model="formData.contract_id" type="purchase" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="下次年费日">
          <el-date-picker
            v-model="formData.next_fee_deadline"
            type="date"
            placeholder="手工填写，或由年费记录自动维护"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="报过高企">
              <el-switch v-model="formData.reported_high_tech" active-text="是" inactive-text="否" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 调价弹窗 ===== -->
    <el-dialog
      v-model="priceDialogVisible"
      title="专利调价"
      width="480px"
      destroy-on-close
    >
      <div v-if="currentRow" class="price-info">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="专利号">{{ currentRow.patent_no }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ currentRow.patent_name }}</el-descriptions-item>
          <el-descriptions-item label="当前价">¥ {{ formatMoney(currentRow.current_price) }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form
        ref="priceFormRef"
        :model="priceFormData"
        :rules="priceFormRules"
        label-width="90px"
        style="margin-top: 16px"
      >
        <el-form-item label="新价格" prop="new_price">
          <el-input-number
            v-model="priceFormData.new_price"
            :precision="2"
            :min="0"
            :step="1000"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="调价日期" prop="change_date">
          <el-date-picker
            v-model="priceFormData.change_date"
            type="date"
            placeholder="默认今日"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="调价原因" prop="reason">
          <el-input v-model="priceFormData.reason" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="priceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="priceSubmitLoading" @click="handlePriceSubmit">确定调价</el-button>
      </template>
    </el-dialog>

    <!-- ===== 批量调价弹窗 ===== -->
    <el-dialog
      v-model="batchDialogVisible"
      title="批量调价"
      width="560px"
      destroy-on-close
    >
      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          不指定任何筛选条件时，默认仅影响"在库"专利。影响范围不可撤销，请谨慎。
        </template>
      </el-alert>
      <el-form ref="batchFormRef" :model="batchFormData" :rules="batchFormRules" label-width="100px">
        <el-form-item label="调价方式" prop="mode">
          <el-radio-group v-model="batchFormData.mode">
            <el-radio value="fixed">统一价格</el-radio>
            <el-radio value="percent">按百分比</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item
          v-if="batchFormData.mode === 'fixed'"
          label="新价格"
          prop="new_price"
        >
          <el-input-number
            v-model="batchFormData.new_price"
            :precision="2"
            :min="0"
            :step="1000"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item
          v-else
          label="调整百分比"
          prop="percent"
        >
          <el-input-number
            v-model="batchFormData.percent"
            :precision="2"
            :min="-100"
            :step="5"
            style="width: 100%"
          />
          <div class="form-tip">正数上调，负数下调。例如 10 表示上调 10%，-5 表示下调 5%</div>
        </el-form-item>

        <el-form-item label="限制领域">
          <el-input v-model="batchFormData.tech_field" placeholder="留空表示不限领域" />
        </el-form-item>

        <el-form-item label="限制状态">
          <el-select v-model="batchFormData.status" clearable placeholder="默认仅在库" style="width: 100%">
            <el-option
              v-for="(val, key) in INVENTORY_STATUS_MAP"
              :key="key"
              :label="val.label"
              :value="key"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="调价日期">
          <el-date-picker
            v-model="batchFormData.change_date"
            type="date"
            placeholder="默认今日"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item label="调价原因">
          <el-input v-model="batchFormData.reason" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSubmitLoading" @click="handleBatchSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 即将到期抽屉 ===== -->
    <el-drawer
      v-model="expiringDrawerVisible"
      title="即将到期年费"
      size="720px"
      destroy-on-close
    >
      <div class="expiring-wrapper">
        <el-form inline>
          <el-form-item label="预警窗口">
            <el-select v-model="expiringDays" style="width: 140px" @change="fetchExpiring">
              <el-option label="7 天内" :value="7" />
              <el-option label="30 天内" :value="30" />
              <el-option label="60 天内" :value="60" />
              <el-option label="90 天内" :value="90" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-table :data="expiringList" v-loading="expiringLoading" border stripe>
          <el-table-column prop="patent_no" label="专利号" width="150" />
          <el-table-column prop="patent_name" label="名称" min-width="200" show-overflow-tooltip />
          <el-table-column label="到期日" width="110" align="center">
            <template #default="{ row }">{{ formatDate(row.next_fee_deadline) }}</template>
          </el-table-column>
          <el-table-column prop="days_left" label="剩余天数" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.days_left <= 7 ? 'danger' : (row.days_left <= 30 ? 'warning' : '')" size="small">
                {{ row.days_left }} 天
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="现价" width="110" align="right">
            <template #default="{ row }">¥ {{ formatMoney(row.current_price) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button type="primary" link size="small" @click="goDetailFromDrawer(row)">
                查看
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <!-- ===== 批量入库弹窗 ===== -->
    <BatchImportDialog ref="batchImportRef" @success="handleBatchImportSuccess" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Plus, Money, Bell, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getInventoryList,
  getInventoryOverview,
  getExpiringInventory,
  createInventory,
  updateInventory,
  deleteInventory,
  changeInventoryStatus,
  changeInventoryPrice,
  batchChangePrice
} from '@/api/inventory'
import { formatMoney, formatDate } from '@/utils/format'
import { INVENTORY_STATUS_MAP } from '@/utils/constants'
import SupplierSelect from '@/components/business/SupplierSelect.vue'
import ContractSelect from '@/components/business/ContractSelect.vue'
import ExportButton from '@/components/common/ExportButton.vue'
import BatchImportDialog from './BatchImportDialog.vue'

const router = useRouter()

// ===== 列表状态 =====
const loading = ref(false)
const inventoryList = ref([])
const searchKeyword = ref('')
const filterStatus = ref('')
const filterTechField = ref('')
const filterMinAge = ref(null)
const filterMaxAge = ref(null)
const sortField = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

// 总览统计
const overview = ref(null)

/** 导出按钮参数：复用当前筛选条件 */
const exportParams = computed(() => {
  const p = {}
  if (searchKeyword.value) p.keyword = searchKeyword.value
  if (filterStatus.value) p.status = filterStatus.value
  if (filterTechField.value) p.tech_field = filterTechField.value
  if (filterMinAge.value !== null && filterMinAge.value !== '') p.min_age = filterMinAge.value
  if (filterMaxAge.value !== null && filterMaxAge.value !== '') p.max_age = filterMaxAge.value
  if (sortField.value) {
    p.sort = sortField.value
    p.order = 'desc'
  }
  return p
})

// ===== 入库/编辑弹窗 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentRow = ref(null)

const formData = reactive({
  patent_no: '',
  patent_name: '',
  patent_type: '',
  tech_field: '',
  purchase_price: 0,
  current_price: 0,
  purchase_date: null,
  stock_in_date: new Date().toISOString().slice(0, 10),
  supplier_id: null,
  contract_id: null,
  status: 'in_stock',
  next_fee_deadline: null,
  reported_high_tech: false,
  remark: ''
})

const formRules = {
  patent_no: [{ required: true, message: '请输入专利号', trigger: 'blur' }],
  patent_name: [{ required: true, message: '请输入专利名称', trigger: 'blur' }]
}

// ===== 调价弹窗 =====
const priceDialogVisible = ref(false)
const priceSubmitLoading = ref(false)
const priceFormRef = ref(null)
const priceFormData = reactive({
  new_price: 0,
  change_date: new Date().toISOString().slice(0, 10),
  reason: ''
})
const priceFormRules = {
  new_price: [{ required: true, message: '请输入新价格', trigger: 'blur' }],
  change_date: [{ required: true, message: '请选择调价日期', trigger: 'change' }]
}

// ===== 批量调价弹窗 =====
const batchDialogVisible = ref(false)
const batchSubmitLoading = ref(false)
const batchFormRef = ref(null)
const batchFormData = reactive({
  mode: 'percent',
  new_price: 0,
  percent: 0,
  tech_field: '',
  status: '',
  change_date: new Date().toISOString().slice(0, 10),
  reason: ''
})
const batchFormRules = {
  mode: [{ required: true, message: '请选择调价方式', trigger: 'change' }]
}

// ===== 即将到期抽屉 =====
const expiringDrawerVisible = ref(false)
const expiringLoading = ref(false)
const expiringDays = ref(60)
const expiringList = ref([])

// ===== 批量入库 =====
const batchImportRef = ref(null)

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
    if (filterTechField.value) params.tech_field = filterTechField.value
    if (filterMinAge.value !== null && filterMinAge.value !== '') params.min_age = filterMinAge.value
    if (filterMaxAge.value !== null && filterMaxAge.value !== '') params.max_age = filterMaxAge.value
    if (sortField.value) {
      params.sort = sortField.value
      params.order = 'desc'
    }

    const res = await getInventoryList(params)
    inventoryList.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取库存列表失败', e)
  } finally {
    loading.value = false
  }
}

async function fetchOverview() {
  try {
    const res = await getInventoryOverview()
    overview.value = res.data || null
  } catch (e) {
    console.error('获取库存总览失败', e)
  }
}

async function fetchExpiring() {
  expiringLoading.value = true
  try {
    const res = await getExpiringInventory({ days: expiringDays.value })
    expiringList.value = res.data || []
  } catch (e) {
    console.error('获取到期列表失败', e)
  } finally {
    expiringLoading.value = false
  }
}

// ===== 交互 =====

function handleSearch() {
  pagination.page = 1
  fetchList()
}

function resetForm() {
  Object.assign(formData, {
    patent_no: '',
    patent_name: '',
    patent_type: '',
    tech_field: '',
    purchase_price: 0,
    current_price: 0,
    purchase_date: null,
    stock_in_date: new Date().toISOString().slice(0, 10),
    supplier_id: null,
    contract_id: null,
    status: 'in_stock',
    next_fee_deadline: null,
    reported_high_tech: false,
    remark: ''
  })
}

function handleCreate() {
  isEdit.value = false
  resetForm()
  dialogVisible.value = true
}

/** 入库下拉菜单命令 */
function handleCreateCommand(command) {
  if (command === 'single') {
    handleCreate()
  } else if (command === 'batch') {
    openBatchImport()
  }
}

function handleEdit(row) {
  isEdit.value = true
  currentRow.value = row
  Object.assign(formData, {
    patent_no: row.patent_no,
    patent_name: row.patent_name,
    patent_type: row.patent_type || '',
    tech_field: row.tech_field || '',
    purchase_price: parseFloat(row.purchase_price) || 0,
    current_price: parseFloat(row.current_price) || 0,
    purchase_date: row.purchase_date || null,
    stock_in_date: row.stock_in_date || null,
    supplier_id: row.supplier_id || null,
    contract_id: row.contract_id || null,
    status: row.status,
    next_fee_deadline: row.next_fee_deadline || null,
    reported_high_tech: row.reported_high_tech || false,
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
      // 编辑时剥离 current_price（必须走 /price 调价接口）
      delete data.current_price
      delete data.status // 状态变更走 /status 接口
      await updateInventory(currentRow.value.id, data)
      ElMessage.success('更新成功')
    } else {
      await createInventory(data)
      ElMessage.success('入库成功')
    }
    dialogVisible.value = false
    fetchList()
    fetchOverview()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

function handleView(row) {
  router.push(`/inventory/${row.id}`)
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      '删除库存记录将同时删除所有年费和调价历史，确定继续？',
      '提示',
      { type: 'warning' }
    )
    await deleteInventory(row.id)
    ElMessage.success('已删除')
    fetchList()
    fetchOverview()
  } catch (e) {
    // 用户取消
  }
}

// 状态变更（下拉菜单）
async function handleStatusCommand(row, command) {
  const statusLabel = INVENTORY_STATUS_MAP[command]?.label || command
  try {
    await ElMessageBox.confirm(`确定将该专利状态变更为"${statusLabel}"？`, '提示', { type: 'warning' })
    const data = { status: command }
    if (command === 'sold') {
      data.stock_out_date = new Date().toISOString().slice(0, 10)
    }
    await changeInventoryStatus(row.id, data)
    ElMessage.success('状态变更成功')
    fetchList()
    fetchOverview()
  } catch (e) {
    // 用户取消
  }
}

// 单个调价
function handlePriceChange(row) {
  currentRow.value = row
  Object.assign(priceFormData, {
    new_price: parseFloat(row.current_price) || 0,
    change_date: new Date().toISOString().slice(0, 10),
    reason: ''
  })
  priceDialogVisible.value = true
}

async function handlePriceSubmit() {
  const valid = await priceFormRef.value.validate().catch(() => false)
  if (!valid) return

  priceSubmitLoading.value = true
  try {
    await changeInventoryPrice(currentRow.value.id, { ...priceFormData })
    ElMessage.success('调价成功')
    priceDialogVisible.value = false
    fetchList()
    fetchOverview()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    priceSubmitLoading.value = false
  }
}

// 批量调价
function openBatchPriceDialog() {
  Object.assign(batchFormData, {
    mode: 'percent',
    new_price: 0,
    percent: 0,
    tech_field: '',
    status: '',
    change_date: new Date().toISOString().slice(0, 10),
    reason: ''
  })
  batchDialogVisible.value = true
}

async function handleBatchSubmit() {
  const valid = await batchFormRef.value.validate().catch(() => false)
  if (!valid) return

  // 二次确认
  const scope = []
  if (batchFormData.tech_field) scope.push(`领域=${batchFormData.tech_field}`)
  if (batchFormData.status) scope.push(`状态=${batchFormData.status}`)
  if (scope.length === 0) scope.push('全部在库专利')

  const desc = batchFormData.mode === 'fixed'
    ? `统一调整为 ¥${batchFormData.new_price}`
    : `按 ${batchFormData.percent >= 0 ? '+' : ''}${batchFormData.percent}% 调整`

  try {
    await ElMessageBox.confirm(
      `将对 ${scope.join('、')} ${desc}。此操作不可撤销，确定继续？`,
      '批量调价确认',
      { type: 'warning', confirmButtonText: '确定执行' }
    )
  } catch (e) {
    return // 用户取消
  }

  batchSubmitLoading.value = true
  try {
    const data = { ...batchFormData }
    // 清理无关字段
    if (data.mode === 'fixed') delete data.percent
    if (data.mode === 'percent') delete data.new_price
    if (!data.tech_field) delete data.tech_field
    if (!data.status) delete data.status

    const res = await batchChangePrice(data)
    ElMessage.success(`批量调价完成，影响 ${res.data?.affected || 0} 条`)
    batchDialogVisible.value = false
    fetchList()
    fetchOverview()
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    batchSubmitLoading.value = false
  }
}

// 即将到期
function openExpiringDrawer() {
  expiringDrawerVisible.value = true
  fetchExpiring()
}

function goDetailFromDrawer(row) {
  expiringDrawerVisible.value = false
  router.push(`/inventory/${row.id}`)
}

// 批量入库
function openBatchImport() {
  batchImportRef.value?.open()
}

function handleBatchImportSuccess() {
  fetchList()
  fetchOverview()
}

/**
 * 按到期日剩余天数着色
 * - <= 7 天：红色（紧急）
 * - <= 30 天：橙色（警告）
 * - 其他：无样式
 */
function getDeadlineClass(deadline) {
  if (!deadline) return ''
  const today = new Date(new Date().toISOString().slice(0, 10))
  const d = new Date(deadline)
  const diff = Math.floor((d - today) / (24 * 3600 * 1000))
  if (diff <= 7) return 'text-danger'
  if (diff <= 30) return 'text-warning'
  return ''
}

onMounted(() => {
  fetchList()
  fetchOverview()
})
</script>

<style scoped lang="scss">
.inventory-list-container {
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

.stat-sub {
  margin-left: 4px;
  font-size: 12px;
  color: #909399;
  font-weight: normal;
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

.price-info {
  margin-bottom: 8px;
}

.expiring-wrapper {
  padding: 0 8px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
