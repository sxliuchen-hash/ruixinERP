<!--
  ============================================================
  专利库存批量入库弹窗（BatchImportDialog）
  ============================================================
  流程：
    1. 下载模板 → 填写数据
    2. 上传 Excel → 后端解析校验 → 展示预览（通过/失败）
    3. 确认导入 → 后端逐条入库 + 调用 IP 系统补全信息
  ============================================================
-->
<template>
  <el-dialog
    v-model="visible"
    title="批量入库"
    width="900px"
    destroy-on-close
    @close="handleClose"
  >
    <!-- 步骤条 -->
    <el-steps :active="step" finish-status="success" simple style="margin-bottom: 20px">
      <el-step title="上传文件" />
      <el-step title="预览校验" />
      <el-step title="导入结果" />
    </el-steps>

    <!-- ===== Step 1: 上传文件 ===== -->
    <div v-if="step === 0" class="step-content">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          <div>
            <p style="margin: 0 0 8px 0">请按模板格式填写 Excel 后上传。必填字段：<strong>专利号</strong>。</p>
            <p style="margin: 0">专利名称、类型等详情信息将自动从 IP 系统获取，无需手动填写。</p>
          </div>
        </template>
      </el-alert>

      <div class="upload-area">
        <el-button type="success" @click="handleDownloadTemplate" :loading="templateLoading">
          <el-icon><Download /></el-icon>下载导入模板
        </el-button>

        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :limit="1"
          accept=".xlsx,.xls"
          :on-change="handleFileChange"
          :on-exceed="handleExceed"
          drag
          style="margin-top: 16px"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">
            将 Excel 文件拖到此处，或 <em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">仅支持 .xlsx / .xls 格式，文件大小不超过 10MB</div>
          </template>
        </el-upload>
      </div>

      <div style="text-align: right; margin-top: 16px">
        <el-button @click="visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="validateLoading"
          :disabled="!selectedFile"
          @click="handleValidate"
        >
          上传并校验
        </el-button>
      </div>
    </div>

    <!-- ===== Step 2: 预览校验结果 ===== -->
    <div v-else-if="step === 1" class="step-content">
      <el-row :gutter="16" style="margin-bottom: 16px">
        <el-col :span="8">
          <el-statistic title="总行数" :value="validateResult.total" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="校验通过" :value="validateResult.validCount">
            <template #suffix>
              <span style="color: #67c23a; font-size: 14px">条</span>
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8">
          <el-statistic title="校验失败" :value="validateResult.errorCount">
            <template #suffix>
              <span style="color: #f56c6c; font-size: 14px">条</span>
            </template>
          </el-statistic>
        </el-col>
      </el-row>

      <!-- 校验通过列表 -->
      <el-tabs v-model="previewTab">
        <el-tab-pane :label="`通过 (${validateResult.validCount})`" name="valid">
          <el-table :data="validateResult.valid" border stripe size="small" max-height="320">
            <el-table-column prop="patent_no" label="专利号" width="150" />
            <el-table-column prop="purchase_price" label="采购价" width="100" align="right">
              <template #default="{ row }">{{ row.purchase_price || 0 }}</template>
            </el-table-column>
            <el-table-column prop="current_price" label="定价" width="100" align="right">
              <template #default="{ row }">{{ row.current_price || 0 }}</template>
            </el-table-column>
            <el-table-column prop="supplier_name" label="供应商" width="140" show-overflow-tooltip />
            <el-table-column prop="purchase_date" label="采购日期" width="110" align="center" />
            <el-table-column label="报过高企" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.reported_high_tech ? 'success' : 'info'" size="small">
                  {{ row.reported_high_tech ? '是' : '否' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
            <el-table-column label="警告" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.warnings?.length" class="text-warning">
                  {{ row.warnings.join('; ') }}
                </span>
                <span v-else>-</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`失败 (${validateResult.errorCount})`" name="errors">
          <el-table :data="validateResult.errors" border stripe size="small" max-height="320">
            <el-table-column prop="rowIndex" label="行号" width="60" align="center" />
            <el-table-column prop="patent_no" label="专利号" width="150" />
            <el-table-column label="错误原因" min-width="300">
              <template #default="{ row }">
                <span class="text-danger">{{ row.errors?.join('; ') }}</span>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!validateResult.errors?.length" description="无校验错误" :image-size="60" />
        </el-tab-pane>
      </el-tabs>

      <div style="text-align: right; margin-top: 16px">
        <el-button @click="step = 0">返回修改</el-button>
        <el-button
          type="primary"
          :loading="importLoading"
          :disabled="validateResult.validCount === 0"
          @click="handleExecuteImport"
        >
          确认导入 {{ validateResult.validCount }} 条
        </el-button>
      </div>
    </div>

    <!-- ===== Step 3: 导入结果 ===== -->
    <div v-else-if="step === 2" class="step-content">
      <el-result
        :icon="importResult.failed > 0 ? 'warning' : 'success'"
        :title="importResult.failed > 0 ? '部分导入成功' : '导入完成'"
        :sub-title="`成功 ${importResult.imported} 条，跳过 ${importResult.skipped} 条，失败 ${importResult.failed} 条`"
      />

      <el-table
        v-if="importResult.details?.length"
        :data="importResult.details"
        border
        stripe
        size="small"
        max-height="300"
        style="margin-top: 16px"
      >
        <el-table-column prop="patent_no" label="专利号" width="150" />
        <el-table-column prop="patent_name" label="专利名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'imported' ? 'success' : (row.status === 'skipped' ? 'info' : 'danger')"
              size="small"
            >
              {{ row.status === 'imported' ? '成功' : (row.status === 'skipped' ? '跳过' : '失败') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
      </el-table>

      <div style="text-align: right; margin-top: 16px">
        <el-button type="primary" @click="handleFinish">完成</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { Download, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  downloadBatchImportTemplate,
  validateBatchImport,
  executeBatchImport
} from '@/api/inventory'

const emit = defineEmits(['success'])

const visible = ref(false)
const step = ref(0)

// Step 1
const templateLoading = ref(false)
const validateLoading = ref(false)
const selectedFile = ref(null)
const uploadRef = ref(null)

// Step 2
const previewTab = ref('valid')
const validateResult = ref({ total: 0, validCount: 0, errorCount: 0, valid: [], errors: [] })

// Step 3
const importLoading = ref(false)
const importResult = ref({ imported: 0, skipped: 0, failed: 0, details: [] })

/** 打开弹窗 */
function open() {
  visible.value = true
  step.value = 0
  selectedFile.value = null
  validateResult.value = { total: 0, validCount: 0, errorCount: 0, valid: [], errors: [] }
  importResult.value = { imported: 0, skipped: 0, failed: 0, details: [] }
}

function handleClose() {
  selectedFile.value = null
}

/** 下载模板 */
async function handleDownloadTemplate() {
  templateLoading.value = true
  try {
    const res = await downloadBatchImportTemplate()
    // 创建下载链接
    const blob = new Blob([res], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '专利批量入库模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error('下载模板失败')
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
  if (!selectedFile.value) return

  validateLoading.value = true
  try {
    const res = await validateBatchImport(selectedFile.value)
    validateResult.value = res.data || { total: 0, validCount: 0, errorCount: 0, valid: [], errors: [] }
    previewTab.value = validateResult.value.errorCount > 0 ? 'errors' : 'valid'
    step.value = 1
  } catch (e) {
    ElMessage.error('文件校验失败，请检查文件格式')
  } finally {
    validateLoading.value = false
  }
}

/** 确认导入 */
async function handleExecuteImport() {
  importLoading.value = true
  try {
    const res = await executeBatchImport(validateResult.value.valid)
    importResult.value = res.data || { imported: 0, skipped: 0, failed: 0, details: [] }
    step.value = 2
    if (importResult.value.imported > 0) {
      emit('success')
    }
  } catch (e) {
    ElMessage.error('导入执行失败')
  } finally {
    importLoading.value = false
  }
}

/** 完成 */
function handleFinish() {
  visible.value = false
  if (importResult.value.imported > 0) {
    emit('success')
  }
}

defineExpose({ open })
</script>

<style scoped lang="scss">
.step-content {
  min-height: 200px;
}

.upload-area {
  text-align: center;
  padding: 16px 0;
}

.text-warning { color: #e6a23c; }
.text-danger { color: #f56c6c; }
</style>
