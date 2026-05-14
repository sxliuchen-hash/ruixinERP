<template>
  <div class="panel" v-if="rule">
    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <strong>采购提成</strong>：采购的专利被卖出时，按卖出时间距采购时间计算提成。时间越长提成越低。
      </template>
    </el-alert>

    <el-row :gutter="24">
      <!-- 发明专利 -->
      <el-col :span="12">
        <h4>发明专利</h4>
        <el-table :data="invention" border size="small">
          <el-table-column prop="label" label="时间段" width="100" />
          <el-table-column label="天数范围" align="center">
            <template #default="{ row }">
              {{ row.days_min }}-{{ row.days_max || '∞' }}天
            </template>
          </el-table-column>
          <el-table-column label="提成(元/件)" width="120" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.amount" :min="0" :step="10" size="small" controls-position="right" />
            </template>
          </el-table-column>
        </el-table>
      </el-col>

      <!-- 实用新型 -->
      <el-col :span="12">
        <h4>实用新型</h4>
        <el-table :data="utility" border size="small">
          <el-table-column prop="label" label="时间段" width="100" />
          <el-table-column label="天数范围" align="center">
            <template #default="{ row }">
              {{ row.days_min }}-{{ row.days_max || '∞' }}天
            </template>
          </el-table-column>
          <el-table-column label="提成(元/件)" width="120" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.amount" :min="0" :step="5" :precision="2" size="small" controls-position="right" />
            </template>
          </el-table-column>
        </el-table>
      </el-col>
    </el-row>

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

const invention = ref([])
const utility = ref([])

watch(() => props.rule, (val) => {
  if (val) {
    invention.value = [...val.rule_value.invention]
    utility.value = [...val.rule_value.utility]
  }
}, { immediate: true })

function handleSave() {
  emit('save', {
    id: props.rule.id,
    rule_value: {
      invention: invention.value,
      utility: utility.value
    }
  })
}
</script>

<style scoped>
h4 { margin: 0 0 8px; font-size: 14px; }
.actions { margin-top: 20px; text-align: right; }
</style>
