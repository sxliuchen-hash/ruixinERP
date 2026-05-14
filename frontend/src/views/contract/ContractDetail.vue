<template>
  <div class="contract-detail-container">
    <!-- 顶部返回 -->
    <div class="page-header">
      <el-button @click="router.back()" plain>
        <el-icon><ArrowLeft /></el-icon>返回
      </el-button>
      <h3>合同详情</h3>
      <div class="header-actions">
        <el-button type="warning" plain size="small" @click="handleConfirm" v-if="contract.confirm_status === 'pending'">
          确认合同
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="detail-content">
      <!-- 合同基本信息 -->
      <el-descriptions title="合同信息" :column="2" border>
        <el-descriptions-item label="合同编号">{{ contract.contract_no }}</el-descriptions-item>
        <el-descriptions-item label="类型">
          <el-tag :type="contract.type === 'sale' ? 'success' : 'warning'" size="small">
            {{ contract.type === 'sale' ? '销售合同' : '采购合同' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="标题">{{ contract.title }}</el-descriptions-item>
        <el-descriptions-item label="客户/供应商">
          {{ contract.customer_name || contract.supplier_name || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="合同金额">
          <span class="money">¥ {{ formatMoney(contract.amount) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="已收/已付">
          <span class="money">¥ {{ formatMoney(contract.paid_amount) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="签订日期">{{ formatDate(contract.sign_date) }}</el-descriptions-item>
        <el-descriptions-item label="到期日期">{{ formatDate(contract.expire_date) }}</el-descriptions-item>
        <el-descriptions-item label="合同状态">
          <el-tag :type="CONTRACT_STATUS_MAP[contract.status]?.type || 'info'" size="small">
            {{ CONTRACT_STATUS_MAP[contract.status]?.label || contract.status }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="确认状态">
          <el-tag :type="CONFIRM_STATUS_MAP[contract.confirm_status]?.type || 'info'" size="small">
            {{ CONFIRM_STATUS_MAP[contract.confirm_status]?.label || contract.confirm_status }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ contract.remark || '-' }}</el-descriptions-item>
      </el-descriptions>

      <!-- 执行进度 -->
      <div class="section">
        <h4>执行进度</h4>
        <div class="progress-wrapper">
          <el-progress
            :percentage="calcProgress()"
            :stroke-width="20"
            :text-inside="true"
            :color="progressColor"
            style="max-width: 600px"
          />
          <p class="progress-text">
            已{{ contract.type === 'sale' ? '收' : '付' }}金额：¥ {{ formatMoney(contract.paid_amount) }} / 合同总额：¥ {{ formatMoney(contract.amount) }}
            <span v-if="remainingAmount > 0" class="remaining">
              （剩余：¥ {{ formatMoney(remainingAmount) }}）
            </span>
          </p>
        </div>
      </div>

      <!-- 附件管理 -->
      <div class="section">
        <h4>合同附件</h4>
        <div class="attachment-area">
          <template v-if="attachmentList.length > 0">
            <div v-for="(file, idx) in attachmentList" :key="idx" class="attachment-item">
              <el-link type="primary" @click="previewFile(file)">
                <el-icon><Document /></el-icon>
                {{ file.field }}
              </el-link>
              <span class="file-size">{{ formatFileSize(file.size) }}</span>
              <el-button size="small" link type="info" @click="downloadFileForce(file)">下载</el-button>
              <el-button size="small" link type="primary" @click="openInNewWindow(file)">新窗口</el-button>
            </div>
          </template>
          <div v-else class="no-attachment">暂无附件</div>
          <el-upload
            :action="uploadUrl"
            :headers="uploadHeaders"
            :on-success="handleUploadSuccess"
            :on-error="handleUploadError"
            :before-upload="beforeUpload"
            :show-file-list="false"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          >
            <el-button type="primary" plain size="small">
              <el-icon><Upload /></el-icon>
              上传附件
            </el-button>
          </el-upload>
          <span class="upload-tip">支持 PDF、图片、Word 文件，大小不超过 10MB</span>
        </div>
      </div>

      <!-- 关联收付款 -->
      <div class="section">
        <h4>关联收付款</h4>
        <el-table :data="payments" border stripe size="small" empty-text="暂无关联收付款记录">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="type" label="类型" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.type === 'income' ? 'success' : 'danger'" size="small">
                {{ row.type === 'income' ? '收款' : '付款' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="120" align="right">
            <template #default="{ row }">
              <span class="money">{{ formatMoney(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="payment_date" label="日期" width="110" align="center" />
          <el-table-column prop="payment_method" label="方式" width="80" align="center">
            <template #default="{ row }">
              {{ paymentMethodLabel(row.payment_method) }}
            </template>
          </el-table-column>
          <el-table-column prop="summary" label="摘要" min-width="160" show-overflow-tooltip />
          <el-table-column prop="confirm_status" label="确认" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.confirm_status === 'confirmed' ? 'success' : 'warning'" size="small">
                {{ row.confirm_status === 'confirmed' ? '已确认' : '待确认' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 关联发票 -->
      <div class="section">
        <h4>关联发票</h4>
        <el-table :data="invoices" border stripe size="small" empty-text="暂无关联发票记录">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="invoice_no" label="发票号" min-width="140" />
          <el-table-column prop="type" label="类型" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.type === 'output' ? '' : 'warning'" size="small">
                {{ row.type === 'output' ? '销项' : '进项' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="invoice_type" label="票种" width="80" align="center">
            <template #default="{ row }">
              {{ row.invoice_type === 'special' ? '专票' : '普票' }}
            </template>
          </el-table-column>
          <el-table-column label="金额" width="120" align="right">
            <template #default="{ row }">
              <span class="money">{{ formatMoney(row.total_amount || row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="invoice_date" label="开票日期" width="110" align="center" />
          <el-table-column prop="status" label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="invoiceStatusType(row.status)" size="small">
                {{ invoiceStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>

  <!-- 文件预览弹窗 -->
  <el-dialog
    v-model="previewVisible"
    :title="previewTitle"
    width="80%"
    top="5vh"
    destroy-on-close
    class="preview-dialog"
  >
    <div class="preview-content">
      <iframe
        v-if="previewUrl"
        :src="previewUrl"
        class="preview-iframe"
        frameborder="0"
      />
    </div>
    <template #footer>
      <el-button @click="previewVisible = false">关闭</el-button>
      <el-button type="primary" @click="openInNewWindow(currentPreviewFile)">新窗口打开</el-button>
      <el-button type="success" @click="downloadFileForce(currentPreviewFile)">下载</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Document, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getContractDetail, confirmContract } from '@/api/contract'
import { formatMoney, formatDate } from '@/utils/format'
import { CONTRACT_STATUS_MAP, CONFIRM_STATUS_MAP } from '@/utils/constants'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const contract = ref({})
const payments = ref([])
const invoices = ref([])

// 附件列表（从 JSON 字段解析）
const attachmentList = computed(() => {
  if (!contract.value?.attachment_url) return []
  try {
    const parsed = JSON.parse(contract.value.attachment_url)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    // 兼容旧格式（单个 URL 字符串）
    if (contract.value.attachment_url.startsWith('http')) {
      return [{ field: '附件', url: contract.value.attachment_url, size: 0 }]
    }
    return []
  }
})

// 文件预览
const previewVisible = ref(false)
const previewUrl = ref('')
const previewTitle = ref('')
const currentPreviewFile = ref(null)

function getFileKey(file) {
  if (!file || !file.url) return ''
  const match = file.url.match(/myqcloud\.com\/(.+)$/)
  return match ? match[1] : ''
}

function previewFile(file) {
  const key = getFileKey(file)
  if (!key) return
  currentPreviewFile.value = file
  previewTitle.value = file.field || '文件预览'
  previewUrl.value = `/api/v1/files/download?key=${encodeURIComponent(key)}&preview=1&token=${encodeURIComponent(userStore.token)}`
  previewVisible.value = true
}

function openInNewWindow(file) {
  const key = getFileKey(file)
  if (!key) return
  const url = `/api/v1/files/download?key=${encodeURIComponent(key)}&preview=1&token=${encodeURIComponent(userStore.token)}`
  window.open(url, '_blank')
}

function downloadFileForce(file) {
  const key = getFileKey(file)
  if (!key) return
  const url = `/api/v1/files/download?key=${encodeURIComponent(key)}&token=${encodeURIComponent(userStore.token)}`
  window.open(url, '_blank')
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 上传相关
const uploadUrl = computed(() => `/api/v1/contracts/${route.params.id}/attachment`)
const uploadHeaders = computed(() => ({
  Authorization: `Bearer ${userStore.token}`
}))

// 剩余金额
const remainingAmount = computed(() => {
  const amount = Number(contract.value.amount) || 0
  const paid = Number(contract.value.paid_amount) || 0
  return Math.max(amount - paid, 0)
})

// 进度条颜色
const progressColor = computed(() => {
  const pct = calcProgress()
  if (pct >= 100) return '#67c23a'
  if (pct >= 50) return '#409eff'
  return '#e6a23c'
})

// 计算执行进度
function calcProgress() {
  if (!contract.value.amount || contract.value.amount === 0) return 0
  const paid = contract.value.paid_amount || 0
  const percent = Math.round((paid / contract.value.amount) * 100)
  return Math.min(percent, 100)
}

// 收付款方式标签
function paymentMethodLabel(method) {
  const map = { transfer: '转账', check: '支票', cash: '现金', other: '其他' }
  return map[method] || method || '-'
}

// 发票状态
function invoiceStatusLabel(status) {
  const map = { pending: '待开', issued: '已开', cancelled: '已作废' }
  return map[status] || status || '-'
}

function invoiceStatusType(status) {
  const map = { pending: 'warning', issued: 'success', cancelled: 'info' }
  return map[status] || 'info'
}

// 上传前校验
function beforeUpload(file) {
  const isValidType = /\.(pdf|jpg|jpeg|png|doc|docx)$/i.test(file.name)
  const isLt10M = file.size / 1024 / 1024 < 10

  if (!isValidType) {
    ElMessage.error('仅支持 PDF、图片、Word 文件格式')
    return false
  }
  if (!isLt10M) {
    ElMessage.error('文件大小不能超过 10MB')
    return false
  }
  return true
}

function handleUploadSuccess(response) {
  ElMessage.success('附件上传成功')
  // 刷新详情
  fetchDetail()
}

function handleUploadError() {
  ElMessage.error('附件上传失败，请重试')
}

// 确认合同
async function handleConfirm() {
  try {
    await confirmContract(route.params.id)
    ElMessage.success('合同已确认')
    fetchDetail()
  } catch (error) {
    // 错误已由拦截器处理
  }
}

// 获取合同详情
async function fetchDetail() {
  const id = route.params.id
  if (!id) return

  loading.value = true
  try {
    const res = await getContractDetail(id)
    contract.value = res.data || {}
    payments.value = res.data?.payments || []
    invoices.value = res.data?.invoices || []
  } catch (error) {
    console.error('获取合同详情失败:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchDetail()
})
</script>

<style scoped lang="scss">
.contract-detail-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
    flex: 1;
  }
}

.header-actions {
  display: flex;
  gap: 8px;
}

.detail-content {
  min-height: 200px;
}

.section {
  margin-top: 32px;

  h4 {
    margin: 0 0 16px;
    font-size: 16px;
    color: #303133;
    border-left: 3px solid #409eff;
    padding-left: 10px;
  }
}

.progress-wrapper {
  padding: 8px 0;
}

.progress-text {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
}

.remaining {
  color: #e6a23c;
}

.attachment-area {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.file-size {
  font-size: 12px;
  color: #909399;
}

.preview-content {
  height: 70vh;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.no-attachment {
  font-size: 13px;
  color: #909399;
}

.upload-tip {
  font-size: 12px;
  color: #909399;
}

.money {
  font-weight: 500;
  color: #303133;
}
</style>
