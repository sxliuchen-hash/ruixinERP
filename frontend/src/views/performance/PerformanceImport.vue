<!--
  ============================================================
  业绩上传页（PerformanceImport）
  ============================================================
  流程：选择归属月 + 下载模板 → 上传 Excel → 预览校验(员工匹配) → 确认入库
  另含「上传历史」Tab：批次列表 + 明细查看 + 删除

  业务规则：
    - 仅 admin 可访问
    - 核定业绩为提成基数；归属月取尾款日期所在月（缺失回退到选择的归属月）
    - 姓名匹配不到员工 → 标红，禁止确认
  ============================================================
-->
<template>
  <div class="perf-import-container">
    <div class="page-header">
      <h3>业绩上传</h3>
    </div>

    <el-tabs v-model="activeTab">
      <!-- ===== 上传 Tab ===== -->
      <el-tab-pane label="上传业绩表" name="upload">
        <el-steps :active="currentStep" finish-status="success" class="steps">
          <el-step title="选择归属月" />
          <el-step title="上传文件" />
          <el-step title="预览校验" />
          <el-step title="导入完成" />
        </el-steps>

        <!-- Step 0 -->
        <div v-if="currentStep === 0" class="step-content">
          <el-alert type="info" :closable="false" style="margin-bottom: 20px">
            <template #title>
              请下载模板按格式填写。核定业绩为提成计算基数；业绩归属"尾款日期所在月"，
              提成在归属月的次月工资条发放。下方选择的归属月用于尾款日期为空时的回退。
            </template>
          </el-alert>

          <el-form inline>
            <el-form-item label="回退归属年月">
              <el-date-picker
                v-model="attrMonth"
                type="month"
                placeholder="选择年月"
                format="YYYY-MM"
                value-format="YYYY-MM"
              />
            </el-form-item>
          </el-form>

          <div class="step-actions">
            <el-button @click="handleDownloadTemplate" :loading="templateLoading">
              <el-icon><Download /></el-icon>下载模板
            </el-button>
            <el-button type="primary" :disabled="!attrMonth" @click="currentStep = 1">
              下一步
            </el-button>
          </div>
        </div>

        <!-- Step 1 -->
        <div v-if="currentStep === 1" class="step-content">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xlsx,.xls"
            :on-change="handleFileChange"
            :on-exceed="handleExceed"
            class="upload-area"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">将 Excel 文件拖到此处，或 <em>点击上传</em></div>
            <template #tip>
              <div class="el-upload__tip">仅支持 .xlsx / .xls，不超过 10MB</div>
            </template>
          </el-upload>

          <div class="step-actions">
            <el-button @click="currentStep = 0">上一步</el-button>
            <el-button type="primary" :disabled="!selectedFile" :loading="validateLoading" @click="handleValidate">
              上传并校验
            </el-button>
          </div>
        </div>

        <!-- Step 2 -->
        <div v-if="currentStep === 2" class="step-content">
          <el-row :gutter="16" class="summary">
            <el-col :span="6">
              <el-card shadow="never"><div class="stat-card"><div class="stat-label">总行数</div><div class="stat-value">{{ validateResult.total }}</div></div></el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never"><div class="stat-card"><div class="stat-label">校验通过</div><div class="stat-value text-success">{{ validateResult.summary?.valid_count || 0 }}</div></div></el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never"><div class="stat-card"><div class="stat-label">校验失败</div><div class="stat-value text-danger">{{ validateResult.summary?.error_count || 0 }}</div></div></el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never"><div class="stat-card"><div class="stat-label">核定业绩合计</div><div class="stat-value">{{ formatMoney(validateResult.summary?.total_performance) }}</div></div></el-card>
            </el-col>
          </el-row>

          <el-tabs v-model="previewTab">
            <el-tab-pane :label="`通过 (${validateResult.summary?.valid_count || 0})`" name="valid">
              <el-table :data="validateResult.valid" border stripe size="small" max-height="400">
                <el-table-column prop="row" label="行号" width="60" align="center" />
                <el-table-column label="姓名" width="90">
                  <template #default="{ row }">{{ row.data.employee_name }}</template>
                </el-table-column>
                <el-table-column label="业务类型" width="120">
                  <template #default="{ row }">{{ row.data.business_type || '-' }}</template>
                </el-table-column>
                <el-table-column label="专利号/项目号" min-width="140">
                  <template #default="{ row }">{{ row.data.target_no || '-' }}</template>
                </el-table-column>
                <el-table-column label="核定业绩" width="110" align="right">
                  <template #default="{ row }">{{ formatMoney(row.data.performance_amount) }}</template>
                </el-table-column>
                <el-table-column label="尾款日期" width="120" align="center">
                  <template #default="{ row }">{{ row.data.final_payment_date || '(回退)' }}</template>
                </el-table-column>
                <el-table-column label="归属月" width="90" align="center">
                  <template #default="{ row }">{{ row.data.year }}-{{ String(row.data.month).padStart(2, '0') }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`失败 (${validateResult.summary?.error_count || 0})`" name="errors">
              <el-table :data="validateResult.errors" border stripe size="small" max-height="400">
                <el-table-column prop="row" label="行号" width="60" align="center" />
                <el-table-column label="姓名" width="90">
                  <template #default="{ row }">{{ row.data.employee_name }}</template>
                </el-table-column>
                <el-table-column label="错误信息" min-width="240">
                  <template #default="{ row }">
                    <div v-for="(err, idx) in row.errors" :key="idx" class="error-item">
                      <el-icon><WarningFilled /></el-icon> {{ err }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="核定业绩" width="110" align="right">
                  <template #default="{ row }">{{ formatMoney(row.data.performance_amount) }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>

          <el-alert
            v-if="validateResult.summary?.error_count > 0"
            type="warning"
            :closable="false"
            style="margin-top: 12px"
            title="存在校验失败的明细（如姓名未匹配到员工），需修正后重新上传才能导入。"
          />

          <div class="step-actions">
            <el-button @click="handleReset">重新上传</el-button>
            <el-button
              type="primary"
              :disabled="!canConfirm"
              :loading="importLoading"
              @click="handleConfirm"
            >
              确认导入 {{ validateResult.summary?.valid_count || 0 }} 条
            </el-button>
          </div>
        </div>

        <!-- Step 3 -->
        <div v-if="currentStep === 3" class="step-content">
          <el-result icon="success" title="业绩导入完成" :sub-title="`已导入 ${importResult.record_count || 0} 条业绩`">
            <template #extra>
              <el-button type="primary" @click="handleReset">继续上传</el-button>
              <el-button @click="activeTab = 'history'; loadBatches()">查看历史</el-button>
            </template>
          </el-result>
        </div>
      </el-tab-pane>

      <!-- ===== 历史 Tab ===== -->
      <el-tab-pane label="上传历史" name="history">
        <el-table :data="batches" border stripe size="small" v-loading="batchLoading">
          <el-table-column label="归属月" width="110" align="center">
            <template #default="{ row }">{{ row.year }}-{{ String(row.month).padStart(2, '0') }}</template>
          </el-table-column>
          <el-table-column prop="file_name" label="文件名" min-width="180" show-overflow-tooltip />
          <el-table-column prop="record_count" label="条数" width="80" align="center" />
          <el-table-column label="核定业绩合计" width="140" align="right">
            <template #default="{ row }">{{ formatMoney(row.total_performance) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'confirmed' ? 'success' : 'info'" size="small">
                {{ row.status === 'confirmed' ? '已确认' : '草稿' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="确认时间" width="160" align="center">
            <template #default="{ row }">{{ formatDateTime(row.confirmed_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="viewBatch(row.id)">明细</el-button>
              <el-button link type="danger" size="small" @click="removeBatch(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 批次明细抽屉 -->
    <el-drawer v-model="detailVisible" title="业绩明细" size="60%">
      <el-table :data="batchRecords" border stripe size="small" max-height="600">
        <el-table-column prop="employee_name" label="姓名" width="90" />
        <el-table-column prop="business_type" label="业务类型" width="120" />
        <el-table-column prop="target_no" label="专利号/项目号" min-width="130" show-overflow-tooltip />
        <el-table-column prop="target_name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="合同金额" width="110" align="right">
          <template #default="{ row }">{{ formatMoney(row.contract_amount) }}</template>
        </el-table-column>
        <el-table-column label="核定业绩" width="110" align="right">
          <template #default="{ row }">{{ formatMoney(row.performance_amount) }}</template>
        </el-table-column>
        <el-table-column prop="final_payment_date" label="尾款日期" width="110" align="center" />
        <el-table-column label="全风险代理" width="90" align="center">
          <template #default="{ row }">{{ row.is_full_risk_agent ? '是' : '否' }}</template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Download, UploadFilled, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  downloadPerformanceTemplate,
  validatePerformanceFile,
  confirmPerformanceImport,
  getPerformanceBatches,
  getPerformanceBatchRecords,
  deletePerformanceBatch
} from '@/api/performanceImport'

const activeTab = ref('upload')
const currentStep = ref(0)
const attrMonth = ref('')
const templateLoading = ref(false)
const selectedFile = ref(null)
const validateLoading = ref(false)
const importLoading = ref(false)
const previewTab = ref('valid')

const validateResult = ref({ total: 0, valid: [], errors: [], summary: {} })
const importResult = ref({ record_count: 0 })

const batches = ref([])
const batchLoading = ref(false)
const detailVisible = ref(false)
const batchRecords = ref([])

const canConfirm = computed(() =>
  (validateResult.value.summary?.valid_count || 0) > 0 &&
  (validateResult.value.summary?.error_count || 0) === 0
)

onMounted(() => {
  const now = new Date()
  attrMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})

// 切换到历史 Tab 时加载批次
watch(activeTab, (val) => {
  if (val === 'history') loadBatches()
})

function parseAttrMonth() {
  const [y, m] = (attrMonth.value || '').split('-')
  return { year: parseInt(y), month: parseInt(m) }
}

async function handleDownloadTemplate() {
  templateLoading.value = true
  try {
    await downloadPerformanceTemplate()
  } catch (e) { /* 已提示 */ } finally {
    templateLoading.value = false
  }
}

function handleFileChange(uploadFile) {
  selectedFile.value = uploadFile.raw
}
function handleExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已选文件')
}

async function handleValidate() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择文件')
    return
  }
  const { year, month } = parseAttrMonth()
  validateLoading.value = true
  try {
    const res = await validatePerformanceFile(selectedFile.value, year, month)
    validateResult.value = res.data || {}
    validateResult.value.file_name = res.data?.file_name
    previewTab.value = (validateResult.value.summary?.error_count || 0) > 0 ? 'errors' : 'valid'
    currentStep.value = 2
  } catch (e) {
    ElMessage.error('校验失败：' + (e.response?.data?.message || e.message))
  } finally {
    validateLoading.value = false
  }
}

async function handleConfirm() {
  const validCount = validateResult.value.summary?.valid_count || 0
  try {
    await ElMessageBox.confirm(`将导入 ${validCount} 条业绩明细，确定继续？`, '确认导入', {
      type: 'warning', confirmButtonText: '确认导入'
    })
  } catch (e) { return }

  const { year, month } = parseAttrMonth()
  importLoading.value = true
  try {
    const records = validateResult.value.valid.map(v => v.data)
    const res = await confirmPerformanceImport({
      year, month,
      file_name: validateResult.value.file_name,
      records
    })
    importResult.value = res.data || {}
    currentStep.value = 3
    ElMessage.success(`已导入 ${importResult.value.record_count} 条业绩`)
  } catch (e) {
    ElMessage.error('导入失败：' + (e.response?.data?.message || e.message))
  } finally {
    importLoading.value = false
  }
}

function handleReset() {
  currentStep.value = 0
  selectedFile.value = null
  validateResult.value = { total: 0, valid: [], errors: [], summary: {} }
  importResult.value = { record_count: 0 }
}

async function loadBatches() {
  batchLoading.value = true
  try {
    const res = await getPerformanceBatches()
    batches.value = res.data || []
  } catch (e) {
    ElMessage.error('加载历史失败')
  } finally {
    batchLoading.value = false
  }
}

async function viewBatch(id) {
  try {
    const res = await getPerformanceBatchRecords(id)
    batchRecords.value = res.data?.records || []
    detailVisible.value = true
  } catch (e) {
    ElMessage.error('加载明细失败')
  }
}

async function removeBatch(id) {
  try {
    await ElMessageBox.confirm('删除批次将连同其明细一并删除，确定？', '确认删除', { type: 'warning' })
  } catch (e) { return }
  try {
    await deletePerformanceBatch(id)
    ElMessage.success('已删除')
    loadBatches()
  } catch (e) {
    ElMessage.error('删除失败：' + (e.response?.data?.message || e.message))
  }
}

function formatMoney(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return '¥0.00'
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatDateTime(v) {
  if (!v) return '-'
  return new Date(v).toLocaleString('zh-CN')
}
</script>

<style scoped lang="scss">
.perf-import-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}
.page-header h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #303133;
}
.steps { margin-bottom: 28px; }
.step-content { min-height: 280px; }
.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}
.upload-area {
  width: 100%;
  :deep(.el-upload-dragger) { width: 100%; padding: 40px 0; }
}
.summary { margin-bottom: 20px; }
.stat-card { display: flex; flex-direction: column; gap: 6px; text-align: center; }
.stat-label { font-size: 13px; color: #909399; }
.stat-value { font-size: 24px; font-weight: 600; color: #303133; }
.error-item {
  display: flex; align-items: center; gap: 4px;
  color: #f56c6c; font-size: 13px; margin-bottom: 2px;
}
.text-success { color: #67c23a; }
.text-danger { color: #f56c6c; }
</style>
