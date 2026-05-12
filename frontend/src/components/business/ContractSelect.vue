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
      v-for="item in contracts"
      :key="item.id"
      :label="`${item.contract_no} - ${item.title}`"
      :value="item.id"
    >
      <div class="contract-option">
        <span class="contract-no">{{ item.contract_no }}</span>
        <span class="contract-title">{{ item.title }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getActiveContracts } from '@/api/contract'

const props = defineProps({
  modelValue: {
    type: [Number, String],
    default: null
  },
  placeholder: {
    type: String,
    default: '请选择合同'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  clearable: {
    type: Boolean,
    default: true
  },
  type: {
    type: String,
    default: '',
    validator: (val) => ['', 'sale', 'purchase'].includes(val)
  }
})

defineEmits(['update:modelValue'])

const contracts = ref([])

async function fetchContracts() {
  try {
    const params = {}
    if (props.type) {
      params.type = props.type
    }
    const res = await getActiveContracts(params)
    contracts.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取合同列表失败:', error)
  }
}

onMounted(() => {
  fetchContracts()
})

// 暴露刷新方法供外部调用
defineExpose({ refresh: fetchContracts })
</script>

<style scoped>
.contract-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.contract-no {
  font-size: 14px;
}

.contract-title {
  font-size: 12px;
  color: #909399;
}
</style>
