<!--
  ============================================================
  银行流水对账页（ReconciliationPage）
  ============================================================
  页面结构：
    Tab A：新建对账
      1) 选择账户 + 上传 Excel（拖拽/点击）
      2) 配置列映射（A/B/C... 分别对应哪个字段）
      3) 表头行号
      4) 点击"开始对账"
    Tab B：对账结果（batch_no 切换）
      - 顶部：统计卡片（总数/已匹配/未匹配/对侧缺失）
      - 三栏：matched / unmatched / extra（ignored 折叠在未匹配下）
      - 未匹配项：一键"创建付款" / "忽略"
      - 已匹配项：可"解除匹配"
    Tab C：对账历史
      - 按批次列出，点击跳转结果页；支持删除
  ============================================================
-->
<template>
  <div class="reconciliation-page">
    <el-tabs v-model="activeTab" class="main-tabs">
      <!-- ============ Tab A：新建对账 ============ -->
      <el-tab-pane label="新建对账" name="upload">
        <el-card shadow="never">
          <el-form :model="uploadForm" label-width="110px">
            <el-form-item label="对账账户" required>
              <AccountSelect v-model="uploadForm.account_id" />
            </el-form-item>

            <el-form-item label="Excel 文件" required>
              <el-upload
                ref="uploadRef"
                :auto-upload="false"
                :on-change="handleFileChange"
                :on-remove="handleFileRemove"
                :limit="1"
                accept=".xlsx,.xls"
                drag
              >
                <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                <div class="el-upload__text">拖拽文件到此处，或<em>点击上传</em></div>
                <template #tip>
                  <div class="el-upload__tip">支持 .xlsx / .xls，最大 10MB</div>
                </template>
              </el-upload>
            </el-form-item>

            <el-form-item label="表头行号">
              <el-input-number v-model="uploadForm.headerRow" :min="1" :max="10" />
              <span class="form-tip">数据从表头的下一行开始读取</span>
            </el-form-item>

            <el-form-item label="列映射" required>
              <el-alert type="info" :closable="false" style="margin-bottom: 12px">
                <template #title>
                  填入 Excel 中各字段所在的列（A/B/C...）。
                  "金额"与"收入/支出"二选一：若 Excel 用一列区分正负，填"金额"；
                  若 Excel 用"收入"和"支出"两列，分别填入。
                </template>
              </el-alert>
              <el-row :gutter="12">
                <el-col :span="6">
                  <label>交易日期</label>
                  <el-input v-model="uploadForm.columnMap.trans_date" placeholder="如 A" />
                </el-col>
                <el-col :span="6">
                  <label>金额（含正负）</label>
                  <el-input v-model="uploadForm.columnMap.amount" placeholder="如 B" />
                </el-col>
                <el-col :span="6">
                  <label>收入（可选）</label>
                  <el-input v-model="uploadForm.columnMap.amount_income" placeholder="如 C" />
                </el-col>
                <el-col :span="6">
                  <label>支出（可选）</label>
                  <el-input v-model="uploadForm.columnMap.amount_expense" placeholder="如 D" />
                </el-col>
              </el-row>
              <el-row :gutter="12" style="margin-top: 12px">
                <el-col :span="6">
                  <label>摘要</label>
                  <el-input v-model="uploadForm.columnMap.summary" placeholder="如 E" />
                </el-col>
                <el-col :span="6">
                  <label>对方户名</label>
                  <el-input v-model="uploadForm.columnMap.counterparty" placeholder="如 F" />
                </el-col>
                <el-col :span="6">
                  <label>余额（可选）</label>
                  <el-input v-model="uploadForm.columnMap.balance" placeholder="如 G" />
                </el-col>
              </el-row>
            </el-form-item>

            <el-form-item label="工作表（可选）">
              <el-input v-model="uploadForm.sheetName" placeholder="留空则使用第一个工作表" />
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                :loading="uploadLoading"
                @click="handleUpload"
                :disabled="!canUpload"
              >
                <el-icon><Upload /></el-icon>开始对账
              </el-button>
              <el-button @click="resetUploadForm">重置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- ============ Tab B：对账结果 ============ -->
      <el-tab-pane :disabled="!currentBatchNo" name="result">
        <template #label>
          对账结果
          <el-badge v-if="currentBatchNo" class="tab-badge" value="•" is-dot />
        </template>

        <div v-if="!currentResult" class="empty-tip">
          <el-empty description="请先完成一次上传，或从历史中选择一个批次" :image-size="100" />
        </div>

        <div v-else>
          <el-card shadow="never" class="result-header">
            <div class="result-title">
              <span>批次号：<code>{{ currentResult.batch_no }}</code></span>
              <span class="muted">
                账户 #{{ currentResult.account_id }} ·
                期间 {{ currentResult.period?.start }} ~ {{ currentResult.period?.end }}
              </span>
            </div>
            <div class="stat-row">
              <div class="stat-cell">
                <div class="stat-cell__label">总流水</div>
                <div class="stat-cell__value">{{ currentResult.summary.total }}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-cell__label">已匹配</div>
                <div class="stat-cell__value text-success">{{ currentResult.summary.matched }}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-cell__label">未匹配</div>
                <div class="stat-cell__value text-warning">{{ currentResult.summary.unmatched }}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-cell__label">系统多出</div>
                <div class="stat-cell__value text-danger">{{ currentResult.summary.extra }}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-cell__label">已忽略</div>
                <div class="stat-cell__value">{{ currentResult.summary.ignored }}</div>
              </div>
              <el-button type="primary" @click="fetchResult(currentBatchNo)">
                <el-icon><Refresh /></el-icon>刷新
              </el-button>
            </div>
          </el-card>

          <el-row :gutter="16" class="three-column">
            <!-- 已匹配 -->
            <el-col :span="8">
              <el-card shadow="never" class="col-card col-card--success">
                <template #header>
                  <div class="col-header">
                    <el-icon><CircleCheck /></el-icon>
                    已匹配 ({{ currentResult.matched.length }})
                  </div>
                </template>
                <div class="col-list">
                  <el-empty v-if="!currentResult.matched.length" description="暂无" :image-size="60" />
                  <div
                    v-for="s in currentResult.matched"
                    :key="s.id"
                    class="statement-item"
                  >
                    <div class="statement-item__row">
                      <span class="date">{{ formatDate(s.trans_date) }}</span>
                      <span :class="parseFloat(s.amount) > 0 ? 'text-success' : 'text-danger'">
                        {{ parseFloat(s.amount) > 0 ? '+' : '' }}¥ {{ formatMoney(s.amount) }}
                      </span>
                    </div>
                    <div class="statement-item__summary">{{ s.summary || '-' }}</div>
                    <div class="statement-item__cp">对方：{{ s.counterparty || '-' }}</div>
                    <div class="statement-item__matched">
                      <el-tag type="success" size="small">
                        匹配 payment #{{ s.matched_payment_id }}
                        （{{ s.match_score }}分）
                      </el-tag>
                      <el-button
                        type="danger"
                        link
                        size="small"
                        @click="handleUnmatch(s)"
                      >解除</el-button>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>

            <!-- 未匹配 -->
            <el-col :span="8">
              <el-card shadow="never" class="col-card col-card--warning">
                <template #header>
                  <div class="col-header">
                    <el-icon><Warning /></el-icon>
                    未匹配流水 ({{ currentResult.unmatched.length }})
                  </div>
                </template>
                <div class="col-list">
                  <el-empty v-if="!currentResult.unmatched.length" description="太棒了，全匹配" :image-size="60" />
                  <div
                    v-for="s in currentResult.unmatched"
                    :key="s.id"
                    class="statement-item"
                  >
                    <div class="statement-item__row">
                      <span class="date">{{ formatDate(s.trans_date) }}</span>
                      <span :class="parseFloat(s.amount) > 0 ? 'text-success' : 'text-danger'">
                        {{ parseFloat(s.amount) > 0 ? '+' : '' }}¥ {{ formatMoney(s.amount) }}
                      </span>
                    </div>
                    <div class="statement-item__summary">{{ s.summary || '-' }}</div>
                    <div class="statement-item__cp">对方：{{ s.counterparty || '-' }}</div>
                    <div
                      v-if="s.suggested_category_id"
                      class="statement-item__suggestion"
                    >
                      <el-tag type="info" size="small">
                        建议类别 #{{ s.suggested_category_id }}
                      </el-tag>
                    </div>
                    <div class="statement-item__actions">
                      <el-button type="primary" size="small" @click="openCreatePaymentDialog(s)">
                        创建付款
                      </el-button>
                      <el-button type="info" link size="small" @click="handleIgnore(s)">
                        忽略
                      </el-button>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>

            <!-- 系统多出（extra） -->
            <el-col :span="8">
              <el-card shadow="never" class="col-card col-card--danger">
                <template #header>
                  <div class="col-header">
                    <el-icon><CircleClose /></el-icon>
                    系统多出 ({{ currentResult.extra.length }})
                  </div>
                </template>
                <div class="col-list">
                  <el-empty v-if="!currentResult.extra.length" description="暂无" :image-size="60" />
                  <div
                    v-for="p in currentResult.extra"
                    :key="p.id"
                    class="statement-item"
                  >
                    <div class="statement-item__row">
                      <span class="date">{{ formatDate(p.payment_date) }}</span>
                      <span :class="p.type === 'income' ? 'text-success' : 'text-danger'">
                        {{ p.type === 'income' ? '+' : '-' }}¥ {{ formatMoney(p.amount) }}
                      </span>
                    </div>
                    <div class="statement-item__summary">{{ p.summary || '-' }}</div>
                    <div class="statement-item__cp">
                      payment #{{ p.id }} · {{ p.category === 'business' ? '业务' : '费用' }}类
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>

          <el-card v-if="currentResult.ignored?.length" shadow="never" class="ignored-card">
            <template #header>
              已忽略（{{ currentResult.ignored.length }}）
            </template>
            <el-table :data="currentResult.ignored" size="small" border>
              <el-table-column label="日期" width="110" prop="trans_date">
                <template #default="{ row }">{{ formatDate(row.trans_date) }}</template>
              </el-table-column>
              <el-table-column label="金额" width="140" align="right">
                <template #default="{ row }">
                  <span :class="parseFloat(row.amount) > 0 ? 'text-success' : 'text-danger'">
                    {{ parseFloat(row.amount) > 0 ? '+' : '' }}¥ {{ formatMoney(row.amount) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="summary" label="摘要" show-overflow-tooltip />
              <el-table-column prop="counterparty" label="对方" width="160" show-overflow-tooltip />
            </el-table>
          </el-card>
        </div>
      </el-tab-pane>

      <!-- ============ Tab C：对账历史 ============ -->
      <el-tab-pane label="对账历史" name="history">
        <el-card shadow="never">
          <el-table :data="historyList" v-loading="historyLoading" border stripe>
            <el-table-column prop="batch_no" label="批次号" width="220" />
            <el-table-column prop="account_name" label="账户" width="160" show-overflow-tooltip />
            <el-table-column label="期间" width="200">
              <template #default="{ row }">
                {{ row.start_date }} ~ {{ row.end_date }}
              </template>
            </el-table-column>
            <el-table-column label="总数" width="80" align="center">
              <template #default="{ row }">{{ row.total }}</template>
            </el-table-column>
            <el-table-column label="已匹配" width="90" align="center">
              <template #default="{ row }">
                <span class="text-success">{{ row.matched }}</span>
              </template>
            </el-table-column>
            <el-table-column label="未匹配" width="90" align="center">
              <template #default="{ row }">
                <span class="text-warning">{{ row.unmatched }}</span>
              </template>
            </el-table-column>
            <el-table-column label="忽略" width="80" align="center">
              <template #default="{ row }">{{ row.ignored }}</template>
            </el-table-column>
            <el-table-column label="上传时间" width="160">
              <template #default="{ row }">{{ formatDate(row.create_time, 'YYYY-MM-DD HH:mm') }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="openResult(row.batch_no)">
                  查看
                </el-button>
                <el-button type="danger" link size="small" @click="handleDeleteBatch(row)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrapper">
            <el-pagination
              v-model:current-page="historyPagination.page"
              v-model:page-size="historyPagination.pageSize"
              :total="historyPagination.total"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              @size-change="fetchHistory"
              @current-change="fetchHistory"
            />
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- ===== 创建付款弹窗 ===== -->
    <el-dialog
      v-model="createPaymentDialogVisible"
      title="从流水创建付款"
      width="600px"
      destroy-on-close
    >
      <div v-if="currentStatement" class="statement-preview">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="日期">{{ formatDate(currentStatement.trans_date) }}</el-descriptions-item>
          <el-descriptions-item label="金额">
            <span :class="parseFloat(currentStatement.amount) > 0 ? 'text-success' : 'text-danger'">
              ¥ {{ formatMoney(Math.abs(currentStatement.amount)) }}
              （{{ parseFloat(currentStatement.amount) > 0 ? '收入' : '支出' }}）
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="摘要" :span="2">{{ currentStatement.summary || '-' }}</el-descriptions-item>
          <el-descriptions-item label="对方" :span="2">{{ currentStatement.counterparty || '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form :model="paymentForm" label-width="100px" style="margin-top: 16px">
        <el-form-item label="收付款分类" required>
          <el-radio-group v-model="paymentForm.category">
            <el-radio value="business">业务类</el-radio>
            <el-radio value="fee">费用类</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="paymentForm.category === 'business'">
          <el-form-item label="关联合同" required>
            <ContractSelect
              v-model="paymentForm.contract_id"
              :type="parseFloat(currentStatement?.amount) > 0 ? 'sale' : 'purchase'"
            />
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item v-if="parseFloat(currentStatement?.amount) > 0" label="客户">
                <CustomerSelect v-model="paymentForm.customer_id" />
              </el-form-item>
              <el-form-item v-else label="供应商">
                <SupplierSelect v-model="paymentForm.supplier_id" />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-else>
          <el-form-item label="成本类别">
            <el-input-number
              v-model="paymentForm.cost_category_id"
              :min="1"
              placeholder="类别 ID（暂用数字输入）"
              style="width: 100%"
            />
            <div class="form-tip">若为空将使用算法建议的类别</div>
          </el-form-item>
        </template>

        <el-form-item label="摘要">
          <el-input
            v-model="paymentForm.summary"
            :placeholder="currentStatement?.summary || '保留流水摘要'"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="paymentForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createPaymentDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="createPaymentLoading"
          @click="handleCreatePayment"
        >确定创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  UploadFilled, Upload, Refresh, CircleCheck, CircleClose, Warning
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  uploadStatement,
  getReconciliationResult,
  getReconciliationHistory,
  deleteReconciliationBatch,
  createPaymentFromStatement,
  unmatchStatement,
  ignoreStatement
} from '@/api/reconciliation'
import { formatMoney, formatDate } from '@/utils/format'
import AccountSelect from '@/components/business/AccountSelect.vue'
import ContractSelect from '@/components/business/ContractSelect.vue'
import CustomerSelect from '@/components/business/CustomerSelect.vue'
import SupplierSelect from '@/components/business/SupplierSelect.vue'

// ===== Tab 状态 =====
const activeTab = ref('upload')

// ===== 上传状态 =====
const uploadRef = ref(null)
const uploadLoading = ref(false)
const selectedFile = ref(null)

const uploadForm = reactive({
  account_id: null,
  headerRow: 1,
  sheetName: '',
  columnMap: {
    trans_date: 'A',
    amount: 'B',
    amount_income: '',
    amount_expense: '',
    summary: 'C',
    counterparty: 'D',
    balance: ''
  }
})

const canUpload = computed(() => {
  if (!uploadForm.account_id) return false
  if (!selectedFile.value) return false
  const cm = uploadForm.columnMap
  if (!cm.trans_date) return false
  if (!cm.amount && !cm.amount_income && !cm.amount_expense) return false
  return true
})

function handleFileChange(file) {
  selectedFile.value = file.raw || file
}
function handleFileRemove() {
  selectedFile.value = null
}

async function handleUpload() {
  if (!canUpload.value) {
    ElMessage.warning('请完成账户选择、文件上传和列映射')
    return
  }
  uploadLoading.value = true
  try {
    const fd = new FormData()
    fd.append('file', selectedFile.value)
    fd.append('account_id', uploadForm.account_id)
    fd.append('headerRow', uploadForm.headerRow)
    if (uploadForm.sheetName) fd.append('sheetName', uploadForm.sheetName)
    // 清理 columnMap 中空字符串字段
    const cleaned = {}
    Object.entries(uploadForm.columnMap).forEach(([k, v]) => {
      if (v) cleaned[k] = v
    })
    fd.append('columnMap', JSON.stringify(cleaned))

    const res = await uploadStatement(fd)
    ElMessage.success(res.message || '对账完成')
    currentBatchNo.value = res.data.batch_no
    await fetchResult(res.data.batch_no)
    activeTab.value = 'result'
  } catch (e) {
    // 拦截器已提示
  } finally {
    uploadLoading.value = false
  }
}

function resetUploadForm() {
  uploadForm.account_id = null
  uploadForm.sheetName = ''
  uploadForm.headerRow = 1
  Object.assign(uploadForm.columnMap, {
    trans_date: 'A',
    amount: 'B',
    amount_income: '',
    amount_expense: '',
    summary: 'C',
    counterparty: 'D',
    balance: ''
  })
  uploadRef.value?.clearFiles()
  selectedFile.value = null
}

// ===== 对账结果 =====
const currentBatchNo = ref('')
const currentResult = ref(null)

async function fetchResult(batchNo) {
  try {
    const res = await getReconciliationResult(batchNo)
    currentResult.value = res.data
  } catch (e) { /* 拦截器已提示 */ }
}

async function openResult(batchNo) {
  currentBatchNo.value = batchNo
  await fetchResult(batchNo)
  activeTab.value = 'result'
}

async function handleUnmatch(statement) {
  try {
    await ElMessageBox.confirm('确认解除该笔匹配？', '提示', { type: 'warning' })
    await unmatchStatement(statement.id)
    ElMessage.success('已解除')
    fetchResult(currentBatchNo.value)
  } catch (e) {}
}

async function handleIgnore(statement) {
  try {
    await ElMessageBox.confirm(
      '忽略后该流水不再出现在未匹配列表中，确定继续？',
      '提示',
      { type: 'warning' }
    )
    await ignoreStatement(statement.id)
    ElMessage.success('已忽略')
    fetchResult(currentBatchNo.value)
  } catch (e) {}
}

// ===== 创建付款弹窗 =====
const createPaymentDialogVisible = ref(false)
const createPaymentLoading = ref(false)
const currentStatement = ref(null)
const paymentForm = reactive({
  category: 'fee',
  contract_id: null,
  customer_id: null,
  supplier_id: null,
  cost_category_id: null,
  summary: '',
  remark: ''
})

function openCreatePaymentDialog(statement) {
  currentStatement.value = statement
  Object.assign(paymentForm, {
    category: 'fee',
    contract_id: null,
    customer_id: null,
    supplier_id: null,
    cost_category_id: statement.suggested_category_id || null,
    summary: statement.summary || '',
    remark: ''
  })
  createPaymentDialogVisible.value = true
}

async function handleCreatePayment() {
  createPaymentLoading.value = true
  try {
    const data = { ...paymentForm }
    if (data.category === 'business') {
      if (!data.contract_id) {
        ElMessage.warning('业务类收付款请选择关联合同')
        createPaymentLoading.value = false
        return
      }
      data.cost_category_id = null
    } else {
      data.contract_id = null
      data.customer_id = null
      data.supplier_id = null
    }
    await createPaymentFromStatement(currentStatement.value.id, data)
    ElMessage.success('付款已创建，流水已匹配')
    createPaymentDialogVisible.value = false
    fetchResult(currentBatchNo.value)
  } catch (e) {
    // 拦截器已提示
  } finally {
    createPaymentLoading.value = false
  }
}

// ===== 对账历史 =====
const historyLoading = ref(false)
const historyList = ref([])
const historyPagination = reactive({ page: 1, pageSize: 10, total: 0 })

async function fetchHistory() {
  historyLoading.value = true
  try {
    const res = await getReconciliationHistory({
      page: historyPagination.page,
      pageSize: historyPagination.pageSize
    })
    historyList.value = res.data?.list || []
    historyPagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    // 拦截器已提示
  } finally {
    historyLoading.value = false
  }
}

async function handleDeleteBatch(row) {
  try {
    await ElMessageBox.confirm(
      `将删除批次 ${row.batch_no} 的 ${row.total} 条流水（payments 保留），确定？`,
      '提示',
      { type: 'warning' }
    )
    await deleteReconciliationBatch(row.batch_no)
    ElMessage.success('已删除')
    fetchHistory()
    if (currentBatchNo.value === row.batch_no) {
      currentBatchNo.value = ''
      currentResult.value = null
    }
  } catch (e) {}
}

onMounted(() => {
  fetchHistory()
})
</script>

<style scoped lang="scss">
.reconciliation-page {
  padding: 20px;
}

.main-tabs {
  background: #fff;
  padding: 12px 16px;
  border-radius: 4px;
}

.form-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
}

.tab-badge {
  margin-left: 4px;
}

.empty-tip {
  padding: 40px;
  text-align: center;
}

.result-header {
  margin-bottom: 16px;
}

.result-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  code {
    background: #f0f2f5;
    padding: 2px 8px;
    border-radius: 3px;
    font-family: monospace;
  }

  .muted {
    color: #909399;
    font-size: 13px;
  }
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.stat-cell {
  min-width: 80px;

  &__label {
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
  }

  &__value {
    font-size: 22px;
    font-weight: 600;
    color: #303133;
  }
}

.three-column {
  margin-top: 8px;
}

.col-card {
  height: 620px;
  display: flex;
  flex-direction: column;

  &--success :deep(.el-card__header) { background: #f0f9eb; }
  &--warning :deep(.el-card__header) { background: #fdf6ec; }
  &--danger  :deep(.el-card__header) { background: #fef0f0; }

  :deep(.el-card__body) {
    flex: 1;
    overflow-y: auto;
  }
}

.col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.col-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.statement-item {
  padding: 10px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fff;
  transition: box-shadow 0.2s;

  &:hover { box-shadow: 0 1px 6px rgba(0,0,0,0.06); }

  &__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;

    .date { color: #606266; font-size: 13px; font-weight: normal; }
  }

  &__summary {
    font-size: 12px;
    color: #606266;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__cp {
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
  }

  &__matched,
  &__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }

  &__suggestion {
    margin-top: 4px;
  }
}

.ignored-card {
  margin-top: 16px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.statement-preview {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
}

.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }
</style>
