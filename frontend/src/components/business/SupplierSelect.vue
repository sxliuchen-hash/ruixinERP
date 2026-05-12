<template>
  <el-select
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="clearable"
    filterable
    style="width: 100%"
  >
    <el-option
      v-for="item in suppliers"
      :key="item.id"
      :label="item.name"
      :value="item.id"
    >
      <div class="supplier-option">
        <span class="supplier-name">{{ item.name }}</span>
        <span class="supplier-contact">{{ item.contact_person }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getActiveSuppliers } from '@/api/supplier'

const props = defineProps({
  modelValue: {
    type: [Number, String],
    default: null
  },
  placeholder: {
    type: String,
    default: '请选择供应商'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  clearable: {
    type: Boolean,
    default: true
  }
})

defineEmits(['update:modelValue'])

const suppliers = ref([])

async function fetchSuppliers() {
  try {
    const res = await getActiveSuppliers()
    suppliers.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取供应商列表失败:', error)
  }
}

onMounted(() => {
  fetchSuppliers()
})

// 暴露刷新方法供外部调用
defineExpose({ refresh: fetchSuppliers })
</script>

<style scoped>
.supplier-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.supplier-name {
  font-size: 14px;
}

.supplier-contact {
  font-size: 12px;
  color: #909399;
}
</style>
