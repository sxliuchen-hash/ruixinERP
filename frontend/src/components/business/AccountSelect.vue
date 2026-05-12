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
      v-for="item in accounts"
      :key="item.id"
      :label="`${item.name} (${item.bank_name})`"
      :value="item.id"
    >
      <div class="account-option">
        <span class="account-name">{{ item.name }}</span>
        <span class="account-bank">{{ item.bank_name }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getActiveAccounts } from '@/api/account'

const props = defineProps({
  modelValue: {
    type: [Number, String],
    default: null
  },
  placeholder: {
    type: String,
    default: '请选择银行账户'
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

const accounts = ref([])

async function fetchAccounts() {
  try {
    const res = await getActiveAccounts()
    accounts.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取账户列表失败:', error)
  }
}

onMounted(() => {
  fetchAccounts()
})

// 暴露刷新方法供外部调用
defineExpose({ refresh: fetchAccounts })
</script>

<style scoped>
.account-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.account-name {
  font-size: 14px;
}

.account-bank {
  font-size: 12px;
  color: #909399;
}
</style>
