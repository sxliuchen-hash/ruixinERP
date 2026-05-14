<template>
  <div class="panel" v-if="rule">
    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <strong>职级考核</strong>：每季度末（3/6/9/12月）按上季度累计毛利判定职级，次月生效。达到目标即全额享受该档津贴。
      </template>
    </el-alert>

    <el-table :data="grades" border size="small">
      <el-table-column label="职级" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="gradeType(row.grade)" size="small">{{ row.grade }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="名称" width="80" prop="label" />
      <el-table-column label="季度毛利下限(元)" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.quarterly_min" :min="0" :step="10000" size="small" controls-position="right" />
        </template>
      </el-table-column>
      <el-table-column label="季度毛利上限(元)" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.quarterly_max" :min="0" :step="10000" size="small" controls-position="right"
            :disabled="row.quarterly_max === null" />
          <el-checkbox v-model="row._noLimit" size="small" @change="v => row.quarterly_max = v ? null : 200000"
            style="margin-left: 8px">无上限</el-checkbox>
        </template>
      </el-table-column>
      <el-table-column label="月津贴(元)" width="120" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.allowance" :min="0" :step="100" size="small" controls-position="right" />
        </template>
      </el-table-column>
    </el-table>

    <div class="actions">
      <el-button type="primary" @click="handleSave">保存修改</el-button>
    </div>
  </div>
  <el-empty v-else description="暂无规则数据" />
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ rule: Object })
const emit = defineEmits(['save'])

const grades = ref([])

watch(() => props.rule, (val) => {
  if (val) {
    grades.value = val.rule_value.map(g => ({
      ...g,
      _noLimit: g.quarterly_max === null
    }))
  }
}, { immediate: true })

function gradeType(grade) {
  const map = { A: 'info', B: '', C: 'success', D: 'warning', E: 'danger' }
  return map[grade] || 'info'
}

function handleSave() {
  const value = grades.value.map(g => ({
    grade: g.grade,
    label: g.label,
    quarterly_min: g.quarterly_min,
    quarterly_max: g._noLimit ? null : g.quarterly_max,
    allowance: g.allowance
  }))
  emit('save', { id: props.rule.id, rule_value: value })
}
</script>

<style scoped>
.actions { margin-top: 20px; text-align: right; }
</style>
