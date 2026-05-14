<template>
  <div class="panel" v-if="rules.length">
    <el-table :data="rules" border size="small">
      <el-table-column prop="rule_name" label="参数名称" width="160" />
      <el-table-column label="当前值">
        <template #default="{ row }">
          <div class="value-display">
            <template v-if="editingId === row.id">
              <el-input
                v-model="editValue"
                type="textarea"
                :rows="3"
                size="small"
              />
            </template>
            <template v-else>
              <code>{{ formatValue(row.rule_value) }}</code>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="说明" width="260" />
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-button type="primary" size="small" link @click="saveEdit(row)">保存</el-button>
            <el-button size="small" link @click="cancelEdit">取消</el-button>
          </template>
          <template v-else>
            <el-button type="primary" size="small" link @click="startEdit(row)">编辑</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </div>
  <el-empty v-else description="暂无规则数据" />
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({ rules: Array })
const emit = defineEmits(['save'])

const editingId = ref(null)
const editValue = ref('')

function formatValue(val) {
  if (typeof val === 'object') {
    return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join(', ')
  }
  return String(val)
}

function startEdit(row) {
  editingId.value = row.id
  editValue.value = JSON.stringify(row.rule_value, null, 2)
}

function cancelEdit() {
  editingId.value = null
  editValue.value = ''
}

function saveEdit(row) {
  try {
    const parsed = JSON.parse(editValue.value)
    emit('save', { id: row.id, rule_value: parsed })
    editingId.value = null
  } catch (e) {
    ElMessage.error('JSON 格式错误')
  }
}
</script>

<style scoped>
.value-display code {
  font-size: 12px;
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
