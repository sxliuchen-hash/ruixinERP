<!--
  ============================================================
  标记已售弹窗（MarkAsSoldDialog）
  ============================================================
  用于将一条专利库存标记为"已售"，并填写完整销售归档信息：
    - 成交价格 / 成交时间 / 买家 / 联系方式 / 销售合同 / 备注
  实时显示利润预估（成交价 - 采购价 - 维护成本）

  父组件用法：
    <MarkAsSoldDialog ref="dlg" @success="onSuccess" />
    dlg.value.open(row)
  ============================================================
-->
<template>
  <el-dialog
    v-model="visible"
    title="标记已售"
    width="600px"
    destroy-on-close
    @closed="reset"
  >
    <div v-if="row" class="patent-info">
      <el-descriptions :column="2" size="small" border>
        <el-descriptions-item label="专利号">{{ row.patent_no }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ row.patent_name }}</el-descriptions-item>
        <el-descriptions-item label="采购价">¥ {{ formatMoney(row.purchase_price) }}</el-descriptions-item>
        <el-descriptions-item label="当前售价">¥ {{ formatMoney(row.current_price) }}</el-descriptions-item>
        <el-descriptions-item label="累计维持成本">
          <span class="text-danger">¥ {{ formatMoney(row.total_maintain_cost) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="入库日期">{{ formatDate(row.stock_in_date) || '-' }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      style="margin-top: 16px"
    >
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="成交价格" prop="sold_price">
            <el-input-number
              v-model="form.sold_price"
              :precision="2"
              :min="0"
              :step="1000"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="成交时间" prop="sold_time">
            <el-date-picker
              v-model="form.sold_time"
              type="datetime"
              placeholder="默认当前时间"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="买家名称" prop="buyer_name">
        <el-input v-model="form.buyer_name" maxlength="100" placeholder="必填，买家公司或个人" />
      </el-form-item>

      <el-form-item label="买家联系" prop="buyer_contact">
        <el-input v-model="form.buyer_contact" maxlength="100" placeholder="电话/邮箱（选填）" />
      </el-form-item>

      <el-form-item label="销售合同" prop="sale_contract_id">
        <ContractSelect v-model="form.sale_contract_id" type="sale" />
      </el-form-item>

      <el-form-item label="销售备注" prop="sale_remark">
        <el-input
          v-model="form.sale_remark"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>

      <!-- 利润预估实时显示 -->
      <el-alert :type="profitType" :closable="false" show-icon>
        <template #title>
          <strong>实际利润预估：</strong>
          <span :class="profitClass">¥ {{ formatMoney(estimatedProfit) }}</span>
          <span class="profit-formula">
            （成交价 ¥{{ formatMoney(form.sold_price || 0) }}
            − 采购价 ¥{{ formatMoney(row?.purchase_price || 0) }}
            − 维护成本 ¥{{ formatMoney(row?.total_maintain_cost || 0) }}）
          </span>
        </template>
      </el-alert>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        确认标记已售
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { markAsSold } from '@/api/inventory'
import { formatMoney, formatDate } from '@/utils/format'
import ContractSelect from '@/components/business/ContractSelect.vue'

const emit = defineEmits(['success'])

const visible = ref(false)
const row = ref(null)
const submitting = ref(false)
const formRef = ref(null)

const form = reactive({
  sold_price: 0,
  sold_time: null,
  buyer_name: '',
  buyer_contact: '',
  sale_contract_id: null,
  sale_remark: ''
})

const rules = {
  sold_price: [
    { required: true, message: '请输入成交价格', trigger: 'blur' },
    { type: 'number', min: 0, message: '成交价格不能小于 0', trigger: 'blur' }
  ],
  buyer_name: [{ required: true, message: '请输入买家名称', trigger: 'blur' }]
}

/** 实时利润预估 */
const estimatedProfit = computed(() => {
  if (!row.value) return 0
  const sold = parseFloat(form.sold_price) || 0
  const purchase = parseFloat(row.value.purchase_price) || 0
  const maintain = parseFloat(row.value.total_maintain_cost) || 0
  return parseFloat((sold - purchase - maintain).toFixed(2))
})

const profitType = computed(() => (estimatedProfit.value >= 0 ? 'success' : 'error'))
const profitClass = computed(() =>
  estimatedProfit.value >= 0 ? 'profit-positive' : 'profit-negative'
)

/** 暴露给父组件：打开弹窗 */
function open(targetRow) {
  row.value = targetRow
  // 默认成交价用当前售价
  form.sold_price = parseFloat(targetRow.current_price) || 0
  form.sold_time = null
  form.buyer_name = ''
  form.buyer_contact = ''
  form.sale_contract_id = null
  form.sale_remark = ''
  visible.value = true
}

function reset() {
  row.value = null
  formRef.value?.resetFields()
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const payload = { ...form }
    if (!payload.sold_time) delete payload.sold_time
    if (!payload.buyer_contact) delete payload.buyer_contact
    if (!payload.sale_contract_id) delete payload.sale_contract_id
    if (!payload.sale_remark) delete payload.sale_remark

    await markAsSold(row.value.id, payload)
    ElMessage.success('已标记为已售并归档')
    visible.value = false
    emit('success')
  } catch (e) {
    // 全局拦截器已提示
  } finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>

<style scoped lang="scss">
.patent-info {
  margin-bottom: 8px;
}

.profit-positive { color: #67c23a; font-weight: 600; font-size: 16px; }
.profit-negative { color: #f56c6c; font-weight: 600; font-size: 16px; }

.profit-formula {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
}

.text-danger { color: #f56c6c; }
</style>
