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
      v-for="item in customers"
      :key="item.id"
      :label="item.name"
      :value="item.id"
    >
      <div class="customer-option">
        <span class="customer-name">{{ item.name }}</span>
        <span class="customer-contact">{{ item.contact_person }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getActiveCustomers } from '@/api/customer'

const props = defineProps({
  modelValue: {
    type: [Number, String],
    default: null
  },
  placeholder: {
    type: String,
    default: '请选择客户'
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

const customers = ref([])

async function fetchCustomers() {
  try {
    const res = await getActiveCustomers()
    customers.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取客户列表失败:', error)
  }
}

onMounted(() => {
  fetchCustomers()
})

// 暴露刷新方法供外部调用
defineExpose({ refresh: fetchCustomers })
</script>

<style scoped>
.customer-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.customer-name {
  font-size: 14px;
}

.customer-contact {
  font-size: 12px;
  color: #909399;
}
</style>
