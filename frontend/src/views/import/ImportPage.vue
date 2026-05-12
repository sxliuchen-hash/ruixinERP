<!--
  ============================================================
  历史数据导入页（ImportPage）
  ============================================================
  页面结构：
    步骤条：选择类型 → 上传文件 → 预览校验 → 确认导入 → 完成
    Step 1：选择导入类型（合同/收付款/专利库存/成本记录）+ 下载模板
    Step 2：拖拽上传 Excel
    Step 3：校验结果预览（通过/失败分 Tab 展示）
    Step 4：确认导入 + 结果展示

  业务规则：
    - 仅 admin 角色可访问（路由守卫 + 后端双重校验）
    - 合同/专利库存有重复检测（contract_no / patent_no）
    - 事务批量写入，任一行失败则全部回滚
    - 名称 → ID 自动匹配（客户/供应商/账户/类别）
  ============================================================
-->
<template>
  <div class="import-page-container">
    <h3>历史数据导入</h3>

    <!-- ===== 步骤条 ===== -->
    <el-steps :active="currentStep" finish-status="success" class="import-steps">
      <el-step title="选择类型" />
      <el-step title="上传文件" />
      <el-step title="预览校验" />
      <el-step title="导入结果" />
    </el-steps>

    <!-- ===== Step 0: 选择导入类型 ===== -->
    <div v-if="currentStep === 0" class="step-content">
      <el-alert type="info" :closable="false" style="margin-bottom: 20px">
        <template #title>
          请先下载对应模板，按模板格式填写数据后上传。合同编号和专利号会做重复检测，已存在的记录将被跳过。
        </template>
      </el-alert>

      <el-radio-group v-model="importType" size="large" class="type-selector">
        <el-radio-button
          v-for="item in IMPORT_TYPES"
          :key="item.value"
          :value="item.value"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>

      <div class="type-desc" v-if="importType">
        <p>{{ IMPORT_TYPES.find(t => t.value === importType)?.desc }}</p>
      </div>

      <div class="step-actions">
        <el-button @click="handleDownloadTemplate" :loading="templateLoading">
          <el-icon><Download /></el-icon>下载模板
        </el-button>
        <el-button type="primary" :disabled="!importType" @click="currentStep = 1">
          下一步
        </el-button>
      </div>
    </div>

    <!-- ===== Step 1: 上传文件 ===== -->
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
        <div class="el-upload__text">
          将 Excel 文件拖到此处，或 <em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            仅支持 .xlsx / .xls 格式，文件大小不超过 10MB
          </div>
        </template>
      </el-upload>

      <div class="step-actions">
        <el-button @click="currentStep = 0">上一步</el-button>
        <el-button
          type="primary"
          :disabled="!selectedFile"
          :loading="validateLoading"
          @click="handleValidate"
        >
          上传并校验
        </el-button>
      </div>
    </div>

    <!-- ===== Step 2: 预览校验结果 ===== -->
    <div v-if="currentStep === 2" class="step-content">
      <el-row :gutter="16" class="validate-summary">
        <el-col :span="8">
          <el-card shadow="never">
            <div class="stat-card">
              <div class="stat-label">总行数</div>
              <div class="stat-value">{{ validateResult.total }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never">
            <div class="stat-card">
              <div class="stat-label">校验通过</div>
              <div class="stat-value text-success">{{ validateResult.validCount }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never">
            <div class="stat-card">
              <div class="stat-label">校验失败</div>
              <div class="stat-value text-danger">{{ validateResult.errorCount }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-tabs v-model="previewTab">
        <el-tab-pane :label="`通过 (${validateResult.validCount})`" name="valid">
          <el-table :data="validateResult.valid?.slice(0, 50)" border stripe size="small" max-height="400">
            <el-table-column prop="row" label="行号" width="70" align="center" />
            <el-table-column label="数据预览" min-width="400">
              <template #default="{ row }">
                <span class="preview-text">{{ formatPreview(row.data) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="validateResult.validCount > 50" class="more-tip">
            仅展示前 50 条，共 {{ validateResult.validCount }} 条通过校验
          </div>
        </el-tab-pane>
        <el-tab-pane :label="`失败 (${validateResult.errorCount})`" name="errors">
          <el-table :data="validateResult.errors" border stripe size="small" max-height="400">
            <el-table-column prop="row" label="行号" width="70" align="center" />
            <el-table-column label="错误信息" min-width="300">
              <template #default="{ row }">
                <div v-for="(err, idx) in row.errors" :key="idx" class="error-item">
                  <el-icon><WarningFilled /></el-icon> {{ err }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="数据" min-width="300">
              <template #default="{ row }">
                <span class="preview-text">{{ formatPreview(row.data) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <div class="step-actions">
        <el-button @click="handleReset">重新上传</el-button>
        <el-button
          type="primary"
          :disabled="validateResult.validCount === 0"
          :loading="importLoading"
          @click="handleExecuteImport"
        >
          确认导入 {{ validateResult.validCount }} 条
        </el-button>
      </div>
    </div>

    <!-- ===== Step 3: 导入结果 ===== -->
    <div v-if="currentStep === 3" class="step-content">
      <el-result
        :icon="importResult.imported > 0 ? 'success' : 'warning'"
        :title="importResultTitle"
        :sub-title="importResultSubTitle"
      >
        <template #extra>
          <el-button type="primary" @click="handleReset">继续导入</el-button>
        </template>
      </el-result>

      <!-- 导入明细 -->
      <el-table
        v-if="importResult.details?.length"
        :data="importResult.details"
        border
        stripe
        size="small"
        max-height="300"
        style="margin-top: 16px"
      >
        <el-table-column prop="row" label="行号" width="70" align="center" />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'warning'" size="small">
              {{ row.status === 'success' ? '成功' : '跳过' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="200">
          <template #default="{ row }">
            <span v-if="row.status === 'success'">ID: {{ row.id }}</span>
            <span v-else class="text-warning">{{ row.reason }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Download, UploadFilled, WarningFilled, Document, Money, Box, PriceTag } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { downloadTemplate, validateImportFile, executeImport } from '@/api/import'

// ===== 导入类型定义 =====
const IMPORT_TYPES = [
  { value: 'contracts', label: '合同', icon: 'Document', desc: '导入销售/采购合同。合同编号（contract_no）做重复检测，已存在的将被跳过。客户/供应商按名称自动匹配。' },
  { value: 'payments', label: '收付款', icon: 'Money', desc: '导入收款/付款记录。账户、合同、客户、供应商按名称/编号自动匹配。' },
  { value: 'inventory', label: '专利库存', icon: 'Box', desc: '导入专利库存记录。专利号（patent_no）做重复检测，已存在的将被跳过。供应商按名称自动匹配。' },
  { value: 'costs', label: '成本记录', icon: 'PriceTag', desc: '导入成本记录。类别按名称自动匹配（需先在类别管理中创建）。' }
]

// ===== 状态 =====
const currentStep = ref(0)
const importType = ref('contracts')
const templateLoading = ref(false)
const selectedFile = ref(null)
const validateLoading = ref(false)
const importLoading = ref(false)
const previewTab = ref('valid')

// 校验结果
const validateResult = ref({
  total: 0,
  validCount: 0,
  errorCount: 0,
  valid: [],
  errors: []
})

// 导入结果
const importResult = ref({
  imported: 0,
  skipped: 0,
  details: []
})

// 计算属性
const importResultTitle = ref('')
const importResultSubTitle = ref('')

// ===== 操作 =====

/** 下载模板 */
async function handleDownloadTemplate() {
  if (!importType.value) {
    ElMessage.warning('请先选择导入类型')
    return
  }
  templateLoading.value = true
  try {
    await downloadTemplate(importType.value)
  } catch (e) {
    // 错误已在 API 层提示
  } finally {
    templateLoading.value = false
  }
}

/** 文件选择 */
function handleFileChange(uploadFile) {
  selectedFile.value = uploadFile.raw
}

function handleExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已选文件')
}

/** 上传并校验 */
async function handleValidate() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择文件')
    return
  }
  validateLoading.value = true
  try {
    const res = await validateImportFile(importType.value, selectedFile.value)
    validateResult.value = res.data || {}
    previewTab.value = validateResult.value.errorCount > 0 ? 'errors' : 'valid'
    currentStep.value = 2
  } catch (e) {
    ElMessage.error('校验失败：' + (e.response?.data?.message || e.message))
  } finally {
    validateLoading.value = false
  }
}

/** 确认导入 */
async function handleExecuteImport() {
  try {
    await ElMessageBox.confirm(
      `将导入 ${validateResult.value.validCount} 条数据（校验失败的 ${validateResult.value.errorCount} 条将被忽略）。此操作不可撤销，确定继续？`,
      '确认导入',
      { type: 'warning', confirmButtonText: '确认导入' }
    )
  } catch (e) {
    return // 用户取消
  }

  importLoading.value = true
  try {
    const res = await executeImport(importType.value, validateResult.value.valid)
    importResult.value = res.data || {}
    importResultTitle.value = `导入完成`
    importResultSubTitle.value = `成功 ${importResult.value.imported} 条，跳过 ${importResult.value.skipped} 条`
    currentStep.value = 3
    ElMessage.success(importResultSubTitle.value)
  } catch (e) {
    ElMessage.error('导入失败：' + (e.response?.data?.message || e.message))
  } finally {
    importLoading.value = false
  }
}

/** 重置流程 */
function handleReset() {
  currentStep.value = 0
  selectedFile.value = null
  validateResult.value = { total: 0, validCount: 0, errorCount: 0, valid: [], errors: [] }
  importResult.value = { imported: 0, skipped: 0, details: [] }
}

/** 格式化预览数据（取前几个关键字段） */
function formatPreview(data) {
  if (!data) return '-'
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '')
  return entries.slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' | ')
}
</script>

<style scoped lang="scss">
.import-page-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;

  h3 {
    margin: 0 0 20px;
    font-size: 18px;
    color: #303133;
  }
}

.import-steps {
  margin-bottom: 30px;
}

.step-content {
  min-height: 300px;
}

.type-selector {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;

  :deep(.el-radio-button__inner) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 24px;
  }
}

.type-desc {
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 20px;
  color: #606266;
  font-size: 14px;
}

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

  :deep(.el-upload-dragger) {
    width: 100%;
    padding: 40px 0;
  }
}

.validate-summary {
  margin-bottom: 20px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
}

.stat-label {
  font-size: 13px;
  color: #909399;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.preview-text {
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}

.error-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #f56c6c;
  font-size: 13px;
  margin-bottom: 2px;
}

.more-tip {
  text-align: center;
  color: #909399;
  font-size: 13px;
  margin-top: 12px;
}

.text-success { color: #67c23a; }
.text-danger  { color: #f56c6c; }
.text-warning { color: #e6a23c; }
</style>
