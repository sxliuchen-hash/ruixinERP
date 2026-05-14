<template>
  <div class="panel" v-if="rule">
    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <strong>超额累进计算</strong>：月毛利按各档区间分段计算，每段×对应费率后累加。
      </template>
    </el-alert>

    <el-table :data="tiers" border size="small">
      <el-table-column label="档位" width="80" align="center">
        <template #default="{ $index }">第{{ $index + 1 }}档</template>
      </el-table-column>
      <el-table-column label="区间下限(元)" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.min" :min="0" :step="1000" size="small" controls-position="right" />
        </template>
      </el-table-column>
      <el-table-column label="区间上限(元)" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.max" :min="0" :step="1000" size="small" controls-position="right"
            :placeholder="row.max === null ? '无上限' : ''" />
          <el-checkbox v-model="row._noLimit" size="small" @change="v => row.max = v ? null : 100000"
            style="margin-left: 8px">无上限</el-checkbox>
        </template>
      </el-table-column>
      <el-table-column label="提成费率" width="120" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.rate" :min="0" :max="1" :step="0.01" :precision="2"
            size="small" controls-position="right" />
        </template>
      </el-table-column>
      <el-table-column label="说明" width="120">
        <template #default="{ row }">
          <el-input v-model="row.label" size="small" />
        </template>
      </el-table-column>
    </el-table>

    <!-- 试算 -->
    <div class="calc-section">
      <h4>提成试算</h4>
      <el-row :gutter="16" align="middle">
        <el-col :span="8">
          <el-input-number v-model="testAmount" :min="0" :step="5000" placeholder="输入月毛利"
            style="width: 100%" controls-position="right" />
        </el-col>
        <el-col :span="4">
          <el-button type="primary" size="small" @click="calcCommission">计算</el-button>
        </el-col>
        <el-col :span="12">
          <span v-if="calcResult !== null" class="calc-result">
            提成：<strong>¥{{ calcResult.toLocaleString() }}</strong>
            （综合费率 {{ testAmount > 0 ? (calcResult / testAmount * 100).toFixed(1) : 0 }}%）
          </span>
        </el-col>
      </el-row>
    </div>

    <div class="actions">
      <el-button type="primary" @click="handleSave">保存修改</el-button>
    </div>
  </div>
  <el-empty v-else description="暂无规则数据，请先初始化" />
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ rule: Object })
const emit = defineEmits(['save'])

const tiers = ref([])
const testAmount = ref(40000)
const calcResult = ref(null)

watch(() => props.rule, (val) => {
  if (val) {
    tiers.value = val.rule_value.map(t => ({
      ...t,
      _noLimit: t.max === null
    }))
  }
}, { immediate: true })

function calcCommission() {
  const amount = testAmount.value || 0
  let commission = 0
  let prev = 0
  for (const tier of tiers.value) {
    const limit = tier.max === null ? Infinity : tier.max
    const taxable = Math.min(amount, limit) - prev
    if (taxable <= 0) break
    commission += taxable * tier.rate
    prev = limit
    if (amount <= limit) break
  }
  calcResult.value = parseFloat(commission.toFixed(2))
}

function handleSave() {
  const value = tiers.value.map(t => ({
    min: t.min,
    max: t._noLimit ? null : t.max,
    rate: t.rate,
    label: t.label
  }))
  emit('save', { id: props.rule.id, rule_value: value })
}
</script>

<style scoped>
.calc-section {
  margin-top: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 4px;
}
.calc-section h4 { margin: 0 0 12px; }
.calc-result { font-size: 14px; color: #67c23a; }
.actions { margin-top: 20px; text-align: right; }
</style>
