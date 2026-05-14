<template>
  <div class="panel" v-if="rules.length">
    <!-- 基数配置 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <template #header><strong>缴纳基数</strong></template>
      <el-form :inline="true" size="small" v-if="baseRule">
        <el-form-item label="基数(元)">
          <el-input-number v-model="baseData.base" :min="0" :step="100" controls-position="right" />
        </el-form-item>
        <el-form-item label="城市">
          <el-input v-model="baseData.city" style="width: 100px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveBase">保存</el-button>
        </el-form-item>
      </el-form>
      <div class="tip">
        个人月扣除 ≈ {{ baseData.base }} × 15.3% = <strong>¥{{ (baseData.base * 0.153).toFixed(2) }}</strong>
      </div>
    </el-card>

    <!-- 比例配置 -->
    <el-card shadow="never">
      <template #header><strong>缴纳比例</strong></template>
      <el-table :data="rateList" border size="small" v-if="ratesRule">
        <el-table-column prop="label" label="险种" width="140" />
        <el-table-column label="个人比例" align="center">
          <template #default="{ row }">
            <el-input-number v-model="row.personal" :min="0" :max="1" :step="0.005" :precision="3"
              size="small" controls-position="right" />
            <span class="pct">{{ (row.personal * 100).toFixed(1) }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="公司比例" align="center">
          <template #default="{ row }">
            <el-input-number v-model="row.company" :min="0" :max="1" :step="0.005" :precision="3"
              size="small" controls-position="right" />
            <span class="pct">{{ (row.company * 100).toFixed(1) }}%</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="summary" v-if="rateList.length">
        <span>个人合计：<strong>{{ (personalTotal * 100).toFixed(1) }}%</strong>（月扣 ¥{{ (baseData.base * personalTotal).toFixed(2) }}）</span>
        <span style="margin-left: 24px">公司合计：<strong>{{ (companyTotal * 100).toFixed(1) }}%</strong>（月缴 ¥{{ (baseData.base * companyTotal).toFixed(2) }}）</span>
      </div>
      <div class="actions">
        <el-button type="primary" size="small" @click="saveRates">保存比例</el-button>
      </div>
    </el-card>
  </div>
  <el-empty v-else description="暂无规则数据" />
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({ rules: Array })
const emit = defineEmits(['save'])

const baseRule = ref(null)
const ratesRule = ref(null)
const baseData = ref({ base: 2120, city: '西安' })
const rateList = ref([])

watch(() => props.rules, (val) => {
  if (!val) return
  const base = val.find(r => r.rule_key === 'social_insurance_base')
  const rates = val.find(r => r.rule_key === 'social_insurance_rates')
  if (base) {
    baseRule.value = base
    baseData.value = { ...base.rule_value }
  }
  if (rates) {
    ratesRule.value = rates
    rateList.value = Object.entries(rates.rule_value).map(([key, v]) => ({
      key, ...v
    }))
  }
}, { immediate: true })

const personalTotal = computed(() => rateList.value.reduce((s, r) => s + r.personal, 0))
const companyTotal = computed(() => rateList.value.reduce((s, r) => s + r.company, 0))

function saveBase() {
  emit('save', { id: baseRule.value.id, rule_value: baseData.value })
}

function saveRates() {
  const value = {}
  rateList.value.forEach(r => {
    value[r.key] = { personal: r.personal, company: r.company, label: r.label }
  })
  emit('save', { id: ratesRule.value.id, rule_value: value })
}
</script>

<style scoped>
.tip { margin-top: 12px; font-size: 13px; color: #909399; }
.pct { margin-left: 6px; font-size: 12px; color: #606266; }
.summary { margin-top: 12px; font-size: 13px; color: #303133; }
.actions { margin-top: 16px; text-align: right; }
</style>
