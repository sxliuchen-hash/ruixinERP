<!--
  ============================================================
  专利库存详情页（InventoryDetail）
  ============================================================
  页面结构：
    顶部：返回 + 标题（专利号 + 状态标签）+ 操作按钮（编辑/调价/状态/删除）
    基本信息卡片：名称/类型/领域/采购/入库等 + 派生字段（库龄/利润预估）
    年费记录区：表格 + 新增/删除 + 类型过滤
    调价历史区：时间线展示（最近 → 最早）
  业务联动：
    - 新增/删除年费 → 后端事务内重算 total_maintain_cost / next_fee_deadline
    - 调价成功 → price_history 自动新增一条，无需手工
  ============================================================
-->
<template>
  <div class="inventory-detail-container" v-loading="loading">
    <!-- ===== 顶部：返回 + 标题 ===== -->
    <div class="page-header">
      <div class="title-wrapper">
        <el-button link @click="goBack">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <h3 v-if="detail">
          {{ detail.patent_no }}
          <el-tag
            :type="INVENTORY_STATUS_MAP[detail.status]?.type"
            size="small"
            style="margin-left: 8px"
          >
            {{ INVENTORY_STATUS_MAP[detail.status]?.label }}
          </el-tag>
        </h3>
      </div>
      <div class="header-actions" v-if="detail">
        <el-button type="primary" :loading="ipFeeLoading" @click="fetchIpFeeDetail">
          <el-icon><Refresh /></el-icon>更新年费
        </el-button>
        <el-button type="primary" plain :loading="syncLoading" @click="handleSyncFromIp">
          <el-icon><Connection /></el-icon>同步专利信息
        </el-button>
        <el-button type="success" @click="openPriceDialog">
          <el-icon><Money /></el-icon>调价
        </el-button>
        <el-dropdown trigger="click" @command="handleStatusCommand">
          <el-button type="warning">
            变更状态<el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="in_stock" :disabled="detail.status === 'in_stock'">
                回库
              </el-dropdown-item>
              <el-dropdown-item command="sold" :disabled="detail.status === 'sold'">
                标记售出
              </el-dropdown-item>
              <el-dropdown-item command="transferring" :disabled="detail.status === 'transferring'">
                转让中
              </el-dropdown-item>
              <el-dropdown-item command="abandoned" :disabled="detail.status === 'abandoned'">
                放弃
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- ===== 基本信息 + 财务摘要 ===== -->
    <el-row :gutter="16" v-if="detail">
      <el-col :span="16">
        <el-card shadow="never" class="info-card">
          <template #header>专利基本信息</template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="专利号">{{ detail.patent_no }}</el-descriptions-item>
            <el-descriptions-item label="专利类型">{{ detail.patent_type || '-' }}</el-descriptions-item>
            <el-descriptions-item label="专利名称" :span="2">{{ detail.patent_name }}</el-descriptions-item>
            <el-descriptions-item label="技术领域">{{ detail.tech_field || '-' }}</el-descriptions-item>
            <el-descriptions-item label="供应商">
              {{ detail.supplier ? detail.supplier.name : '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="采购合同">
              <el-button
                v-if="detail.contract"
                type="primary"
                link
                size="small"
                @click="router.push(`/contracts/${detail.contract.id}`)"
              >
                {{ detail.contract.contract_no }}
              </el-button>
              <span v-else>-</span>
            </el-descriptions-item>
            <el-descriptions-item label="采购日期">{{ formatDate(detail.purchase_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="入库日期">{{ formatDate(detail.stock_in_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="出库日期">{{ formatDate(detail.stock_out_date) || '-' }}</el-descriptions-item>
            <el-descriptions-item label="库龄">
              <span v-if="detail.stock_age_days !== null">{{ detail.stock_age_days }} 天</span>
              <span v-else>-</span>
            </el-descriptions-item>
            <el-descriptions-item label="下次年费日" :span="2">
              <span :class="getDeadlineClass(detail.next_fee_deadline)">
                {{ formatDate(detail.next_fee_deadline) || '未设定' }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ detail.remark || '-' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="never" class="info-card">
          <template #header>财务摘要</template>
          <div class="money-summary">
            <div class="money-row">
              <div class="money-label">采购价</div>
              <div class="money-val">¥ {{ formatMoney(detail.purchase_price) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">累计维持成本</div>
              <div class="money-val text-danger">¥ {{ formatMoney(detail.total_maintain_cost) }}</div>
            </div>
            <div class="money-row">
              <div class="money-label">当前售价</div>
              <div class="money-val text-primary">¥ {{ formatMoney(detail.current_price) }}</div>
            </div>
            <el-divider style="margin: 12px 0" />
            <div class="money-row">
              <div class="money-label" style="font-weight: 600">利润预估</div>
              <div
                class="money-val"
                :class="detail.estimate_profit >= 0 ? 'text-success' : 'text-danger'"
                style="font-size: 18px"
              >
                ¥ {{ formatMoney(detail.estimate_profit) }}
              </div>
            </div>
            <div class="formula-tip">
              计算：现价 − 采购价 − 累计维持成本
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== 年费记录 + 调价历史 ===== -->
    <el-row :gutter="16" class="bottom-row" v-if="detail">
      <el-col :span="14">
        <el-card shadow="never" class="section-card">
          <template #header>
            <div class="section-header">
              <span>年费/维持成本记录（{{ detail.annualFees?.length || 0 }} 笔）</span>
              <el-button type="primary" size="small" @click="openFeeDialog">
                <el-icon><Plus /></el-icon>添加年费
              </el-button>
            </div>
          </template>
          <el-table :data="detail.annualFees || []" border stripe size="small">
            <el-table-column prop="fee_date" label="缴费日" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.fee_date) }}</template>
            </el-table-column>
            <el-table-column prop="fee_type" label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="FEE_TYPE_MAP[row.fee_type]?.type"
                  size="small"
                >
                  {{ FEE_TYPE_MAP[row.fee_type]?.label || row.fee_type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">
                <span class="text-danger">¥ {{ formatMoney(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="deadline_date" label="维持至" width="110" align="center">
              <template #default="{ row }">{{ formatDate(row.deadline_date) || '-' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button type="danger" link size="small" @click="handleDeleteFee(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!detail.annualFees?.length" description="暂无年费记录" :image-size="80" />
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never" class="section-card">
          <template #header>
            <span>调价历史（{{ detail.priceHistory?.length || 0 }} 次）</span>
          </template>
          <el-timeline v-if="detail.priceHistory?.length">
            <el-timeline-item
              v-for="h in detail.priceHistory"
              :key="h.id"
              :timestamp="formatDate(h.change_date)"
              placement="top"
              :type="priceTimelineType(h.old_price, h.new_price)"
            >
              <div class="timeline-title">
                <span>¥ {{ formatMoney(h.old_price) }}</span>
                <el-icon style="margin: 0 6px"><ArrowRight /></el-icon>
                <span class="text-primary">¥ {{ formatMoney(h.new_price) }}</span>
                <el-tag
                  :type="priceTimelineType(h.old_price, h.new_price)"
                  size="small"
                  style="margin-left: 8px"
                >
                  {{ priceDeltaLabel(h.old_price, h.new_price) }}
                </el-tag>
              </div>
              <div v-if="h.reason" class="timeline-reason">{{ h.reason }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无调价记录" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <!-- ===== IP 系统年费信息（来自知识产权管理系统） ===== -->
    <el-card shadow="never" class="section-card ip-section" v-if="detail" style="margin-top: 16px">
      <template #header>
        <div class="section-header">
          <span>
            <el-icon style="margin-right: 4px"><Connection /></el-icon>
            国知局年费信息（来自 IP 系统）
          </span>
          <div class="ip-header-actions">
            <span v-if="ipFeeData?.patent?.lastFeeQueryAt" class="ip-update-time">
              数据更新于：{{ formatDateTime(ipFeeData.patent.lastFeeQueryAt) }}
            </span>
            <el-button
              type="primary"
              size="small"
              :loading="ipFeeLoading"
              @click="fetchIpFeeDetail"
            >
              <el-icon><Refresh /></el-icon>刷新年费
            </el-button>
          </div>
        </div>
      </template>

      <!-- 未加载状态 -->
      <div v-if="!ipFeeLoaded && !ipFeeLoading" class="ip-empty-hint">
        <el-button type="primary" @click="fetchIpFeeDetail">
          <el-icon><Download /></el-icon>查询国知局年费信息
        </el-button>
        <p class="form-tip">点击按钮从 IP 系统获取该专利的最新年费数据</p>
      </div>

      <!-- 加载中 -->
      <div v-else-if="ipFeeLoading" v-loading="true" style="min-height: 120px"></div>

      <!-- 加载失败 -->
      <el-alert
        v-else-if="ipFeeError"
        :title="ipFeeError"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 12px"
      />

      <!-- 数据展示 -->
      <template v-else-if="ipFeeData">
        <!-- 年费状态概览 -->
        <el-row :gutter="16" style="margin-bottom: 16px">
          <el-col :span="6">
            <div class="ip-stat-card">
              <div class="ip-stat-label">年费状态</div>
              <el-tag :type="IP_FEE_STATUS_MAP[ipFeeData.patent?.feeStatus]?.type" size="large">
                {{ IP_FEE_STATUS_MAP[ipFeeData.patent?.feeStatus]?.label || '未知' }}
              </el-tag>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="ip-stat-card">
              <div class="ip-stat-label">应缴金额</div>
              <div class="ip-stat-val text-danger">
                ¥ {{ ipFeeData.patent?.feeAmount || 0 }}
                <span v-if="ipFeeData.patent?.feeSurcharge > 0" class="surcharge-tip">
                  (含滞纳金 ¥{{ ipFeeData.patent.feeSurcharge }})
                </span>
              </div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="ip-stat-card">
              <div class="ip-stat-label">缴费截止日</div>
              <div class="ip-stat-val" :class="getDeadlineClass(ipFeeData.patent?.nextFeeDeadline)">
                {{ ipFeeData.patent?.nextFeeDeadline || '-' }}
              </div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="ip-stat-card">
              <div class="ip-stat-label">当前年度</div>
              <div class="ip-stat-val">第 {{ ipFeeData.patent?.feeYear || '-' }} 年</div>
            </div>
          </el-col>
        </el-row>

        <!-- 专利法律状态 -->
        <el-descriptions :column="3" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="法律状态">
            {{ ipFeeData.patent?.legalStatus || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="业务状态">
            {{ ipFeeData.patent?.patentStatusText || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="申请人">
            {{ ipFeeData.patent?.appPerson || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 详细信息（发明人/代理等） -->
        <el-descriptions
          v-if="ipFeeData.detail"
          :column="3"
          border
          size="small"
          title="专利详细信息"
          style="margin-bottom: 16px"
        >
          <el-descriptions-item label="发明人">{{ ipFeeData.detail.inventor || '-' }}</el-descriptions-item>
          <el-descriptions-item label="代理机构">{{ ipFeeData.detail.agency || '-' }}</el-descriptions-item>
          <el-descriptions-item label="代理人">{{ ipFeeData.detail.agent || '-' }}</el-descriptions-item>
          <el-descriptions-item label="IPC 分类号">{{ ipFeeData.detail.ipcCode || '-' }}</el-descriptions-item>
          <el-descriptions-item label="授权日">{{ ipFeeData.detail.grantDate || '-' }}</el-descriptions-item>
          <el-descriptions-item label="授权公告号">{{ ipFeeData.detail.grantNumber || '-' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 应缴年费 -->
        <el-row :gutter="16">
          <el-col :span="12">
            <h4 class="ip-sub-title">应缴费用（{{ ipFeeData.feesDue?.length || 0 }} 项）</h4>
            <el-table
              v-if="ipFeeData.feesDue?.length"
              :data="ipFeeData.feesDue"
              border
              stripe
              size="small"
            >
              <el-table-column prop="feeName" label="费用名称" min-width="160" show-overflow-tooltip />
              <el-table-column prop="amount" label="金额" width="100" align="right">
                <template #default="{ row }">¥ {{ row.amount }}</template>
              </el-table-column>
              <el-table-column prop="deadline" label="截止日" width="110" align="center" />
              <el-table-column prop="feeStatus" label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.feeStatus === '应缴' ? 'danger' : 'info'" size="small">
                    {{ row.feeStatus }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else description="无应缴费用" :image-size="60" />
          </el-col>

          <el-col :span="12">
            <h4 class="ip-sub-title">已缴费用（{{ ipFeeData.feesPaid?.length || 0 }} 项）</h4>
            <el-table
              v-if="ipFeeData.feesPaid?.length"
              :data="ipFeeData.feesPaid"
              border
              stripe
              size="small"
              :max-height="300"
            >
              <el-table-column prop="feeName" label="费用名称" min-width="160" show-overflow-tooltip />
              <el-table-column prop="amount" label="金额" width="100" align="right">
                <template #default="{ row }">¥ {{ row.amount }}</template>
              </el-table-column>
              <el-table-column prop="paidDate" label="缴费日" width="110" align="center" />
              <el-table-column prop="payer" label="缴费人" min-width="120" show-overflow-tooltip />
            </el-table>
            <el-empty v-else description="无已缴记录" :image-size="60" />
          </el-col>
        </el-row>

        <!-- 发文信息 -->
        <div v-if="ipFeeData.dispatches?.length" style="margin-top: 16px">
          <h4 class="ip-sub-title">发文记录（{{ ipFeeData.dispatches.length }} 条）</h4>
          <el-table :data="ipFeeData.dispatches" border stripe size="small" :max-height="240">
            <el-table-column prop="noticeName" label="通知名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="dispatchDate" label="发文日期" width="110" align="center" />
            <el-table-column prop="dispatchMethod" label="发送方式" width="80" align="center" />
            <el-table-column prop="recipient" label="收件人" min-width="140" show-overflow-tooltip />
          </el-table>
        </div>

        <!-- 变更信息 -->
        <div v-if="ipFeeData.changes?.length" style="margin-top: 16px">
          <h4 class="ip-sub-title">变更记录（{{ ipFeeData.changes.length }} 条）</h4>
          <el-table :data="ipFeeData.changes" border stripe size="small" :max-height="240">
            <el-table-column prop="changeName" label="变更事项" min-width="180" show-overflow-tooltip />
            <el-table-column prop="changeDate" label="变更日期" width="110" align="center" />
            <el-table-column prop="changeContent" label="变更内容" min-width="200" show-overflow-tooltip />
          </el-table>
        </div>
      </template>
    </el-card>

    <!-- ===== 调价弹窗 ===== -->
    <el-dialog
      v-model="priceDialogVisible"
      title="专利调价"
      width="480px"
      destroy-on-close
    >
      <el-descriptions v-if="detail" :column="1" size="small" border>
        <el-descriptions-item label="专利号">{{ detail.patent_no }}</el-descriptions-item>
        <el-descriptions-item label="当前价">¥ {{ formatMoney(detail.current_price) }}</el-descriptions-item>
      </el-descriptions>
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
        <el-button type="primary" :loading="priceSubmitLoading" @click="handlePriceSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ===== 添加年费弹窗 ===== -->
    <el-dialog
      v-model="feeDialogVisible"
      title="添加年费记录"
      width="500px"
      destroy-on-close
    >
      <el-form
        ref="feeFormRef"
        :model="feeFormData"
        :rules="feeFormRules"
        label-width="90px"
      >
        <el-form-item label="费用类型" prop="fee_type">
          <el-radio-group v-model="feeFormData.fee_type">
            <el-radio value="annual">年费</el-radio>
            <el-radio value="agency">代理费</el-radio>
            <el-radio value="other">其他</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <el-input-number
            v-model="feeFormData.amount"
            :precision="2"
            :min="0"
            :step="500"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="缴费日期" prop="fee_date">
          <el-date-picker
            v-model="feeFormData.fee_date"
            type="date"
            placeholder="请选择"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="维持至" prop="deadline_date">
          <el-date-picker
            v-model="feeFormData.deadline_date"
            type="date"
            placeholder="本次缴费能维持到的到期日"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
          <div class="form-tip">保存后会自动更新下次年费日字段</div>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="feeFormData.remark" maxlength="200" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="feeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="feeSubmitLoading" @click="handleFeeSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ArrowDown, Money, Plus, Refresh, Download, Connection } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getInventoryDetail,
  changeInventoryStatus,
  changeInventoryPrice,
  addAnnualFee,
  deleteAnnualFee,
  syncFromIpSystem
} from '@/api/inventory'
import { getPatentFeeDetail } from '@/api/patentFee'
import { formatMoney, formatDate } from '@/utils/format'
import { INVENTORY_STATUS_MAP, FEE_TYPE_MAP, IP_FEE_STATUS_MAP } from '@/utils/constants'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const detail = ref(null)

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

// ===== 年费弹窗 =====
const feeDialogVisible = ref(false)
const feeSubmitLoading = ref(false)
const feeFormRef = ref(null)
const feeFormData = reactive({
  fee_type: 'annual',
  amount: 0,
  fee_date: new Date().toISOString().slice(0, 10),
  deadline_date: null,
  remark: ''
})
const feeFormRules = {
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  fee_date: [{ required: true, message: '请选择缴费日期', trigger: 'change' }]
}

// ===== IP 系统年费数据 =====
const ipFeeLoading = ref(false)
const ipFeeLoaded = ref(false)
const ipFeeData = ref(null)
const ipFeeError = ref('')

// ===== IP 系统专利信息同步 =====
const syncLoading = ref(false)

// ===== 数据拉取 =====

async function fetchDetail() {
  loading.value = true
  try {
    const id = parseInt(route.params.id, 10)
    const res = await getInventoryDetail(id)
    detail.value = res.data || null
  } catch (e) {
    console.error('获取库存详情失败', e)
  } finally {
    loading.value = false
  }
}

/** 从 IP 系统获取年费详情 */
async function fetchIpFeeDetail() {
  if (!detail.value?.patent_no) return

  ipFeeLoading.value = true
  ipFeeError.value = ''
  try {
    const res = await getPatentFeeDetail(detail.value.patent_no)
    ipFeeData.value = res.data || null
    ipFeeLoaded.value = true
    ElMessage.success('年费数据已更新')
  } catch (e) {
    ipFeeError.value = e?.response?.data?.message || e?.message || '获取 IP 系统年费信息失败'
    ipFeeLoaded.value = true
    ElMessage.error(ipFeeError.value)
  } finally {
    ipFeeLoading.value = false
  }
}

/** 从 IP 系统同步专利信息（名称、类型、截止日）到本地库存 */
async function handleSyncFromIp() {
  if (!detail.value?.id) return

  try {
    await ElMessageBox.confirm(
      '将从 IP 系统获取该专利的最新信息（名称、类型、年费截止日等）并更新到 ERP 库存。继续吗？',
      '同步专利信息',
      { type: 'info', confirmButtonText: '开始同步' }
    )
  } catch (e) {
    return // 用户取消
  }

  syncLoading.value = true
  try {
    const res = await syncFromIpSystem(detail.value.id)
    const result = res.data || {}
    // 同时刷新本地详情和 IP 数据
    if (result.ipData) {
      ipFeeData.value = result.ipData
      ipFeeLoaded.value = true
    }
    if (result.updated > 0) {
      ElMessage.success(`同步成功，已更新 ${result.updated} 个字段：${(result.synced || []).join('、')}`)
    } else {
      ElMessage.info('数据已是最新，无需更新')
    }
    fetchDetail() // 刷新本地展示
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '同步失败'
    ElMessage.error(msg)
  } finally {
    syncLoading.value = false
  }
}

/** 格式化日期时间 */
function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

// ===== 交互 =====

function goBack() {
  router.push('/inventory')
}

async function handleStatusCommand(command) {
  const label = INVENTORY_STATUS_MAP[command]?.label || command
  try {
    await ElMessageBox.confirm(`确定将该专利状态变更为"${label}"？`, '提示', { type: 'warning' })
    const data = { status: command }
    if (command === 'sold') {
      data.stock_out_date = new Date().toISOString().slice(0, 10)
    }
    await changeInventoryStatus(detail.value.id, data)
    ElMessage.success('状态变更成功')
    fetchDetail()
  } catch (e) {
    // 用户取消
  }
}

function openPriceDialog() {
  Object.assign(priceFormData, {
    new_price: parseFloat(detail.value.current_price) || 0,
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
    await changeInventoryPrice(detail.value.id, { ...priceFormData })
    ElMessage.success('调价成功')
    priceDialogVisible.value = false
    fetchDetail()
  } catch (e) {
    // 拦截器已提示
  } finally {
    priceSubmitLoading.value = false
  }
}

function openFeeDialog() {
  Object.assign(feeFormData, {
    fee_type: 'annual',
    amount: 0,
    fee_date: new Date().toISOString().slice(0, 10),
    deadline_date: null,
    remark: ''
  })
  feeDialogVisible.value = true
}

async function handleFeeSubmit() {
  const valid = await feeFormRef.value.validate().catch(() => false)
  if (!valid) return

  feeSubmitLoading.value = true
  try {
    await addAnnualFee(detail.value.id, { ...feeFormData })
    ElMessage.success('年费记录已添加')
    feeDialogVisible.value = false
    fetchDetail()
  } catch (e) {
    // 拦截器已提示
  } finally {
    feeSubmitLoading.value = false
  }
}

async function handleDeleteFee(fee) {
  try {
    await ElMessageBox.confirm(
      `删除该笔 ¥${formatMoney(fee.amount)} 的年费记录？删除后维持成本和下次年费日将自动重算。`,
      '提示',
      { type: 'warning' }
    )
    await deleteAnnualFee(detail.value.id, fee.id)
    ElMessage.success('已删除')
    fetchDetail()
  } catch (e) {
    // 用户取消
  }
}

// ===== 工具函数 =====

/** 到期日剩余天数着色 */
function getDeadlineClass(deadline) {
  if (!deadline) return ''
  const today = new Date(new Date().toISOString().slice(0, 10))
  const d = new Date(deadline)
  const diff = Math.floor((d - today) / (24 * 3600 * 1000))
  if (diff <= 7) return 'text-danger'
  if (diff <= 30) return 'text-warning'
  return ''
}

/** 调价方向 → Timeline 类型 */
function priceTimelineType(oldPrice, newPrice) {
  const o = parseFloat(oldPrice) || 0
  const n = parseFloat(newPrice) || 0
  if (n > o) return 'success'
  if (n < o) return 'danger'
  return 'info'
}

/** 调价幅度标签 */
function priceDeltaLabel(oldPrice, newPrice) {
  const o = parseFloat(oldPrice) || 0
  const n = parseFloat(newPrice) || 0
  if (o === 0) return n > 0 ? '新设' : '持平'
  const delta = ((n - o) / o * 100).toFixed(1)
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta}%`
}

onMounted(() => {
  fetchDetail()
})
</script>

<style scoped lang="scss">
.inventory-detail-container {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  padding: 12px 16px;
  border-radius: 4px;
  margin-bottom: 16px;
}

.title-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
  }
}

.header-actions {
  display: flex;
  gap: 8px;
}

.info-card {
  height: 100%;
}

.bottom-row {
  margin-top: 16px;
}

.section-card {
  height: 100%;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.money-summary {
  padding: 8px 4px;
}

.money-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;

  .money-label {
    font-size: 13px;
    color: #606266;
  }

  .money-val {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }
}

.formula-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  text-align: right;
}

.timeline-title {
  display: flex;
  align-items: center;
  font-size: 14px;
}

.timeline-reason {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
  margin-top: 4px;
}

.text-primary { color: #409eff; }
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger  { color: #f56c6c; }

// ===== IP 系统年费区域 =====
.ip-section {
  :deep(.el-card__header) {
    background: #f0f9ff;
  }
}

.ip-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ip-update-time {
  font-size: 12px;
  color: #909399;
}

.ip-empty-hint {
  text-align: center;
  padding: 24px 0;

  p {
    margin-top: 8px;
  }
}

.ip-stat-card {
  text-align: center;
  padding: 12px 8px;
  background: #fafafa;
  border-radius: 6px;

  .ip-stat-label {
    font-size: 12px;
    color: #909399;
    margin-bottom: 6px;
  }

  .ip-stat-val {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }
}

.surcharge-tip {
  font-size: 12px;
  font-weight: normal;
  color: #e6a23c;
}

.ip-sub-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
  padding-left: 8px;
  border-left: 3px solid #409eff;
}
</style>
