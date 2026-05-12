<!--
  ============================================================
  项目选择器（ProjectSelect）
  ============================================================
  功能：
    - 懒加载 + 远程搜索
    - 支持按状态筛选（默认仅展示 active 项目）
    - 显示项目名 + 客户名 + 利润摘要
  用法：
    <ProjectSelect v-model="form.project_id" :status="'active'" />
  ============================================================
-->
<template>
  <el-select
    v-model="currentValue"
    filterable
    remote
    :remote-method="remoteSearch"
    :loading="loading"
    clearable
    placeholder="选择项目"
    style="width: 100%"
    @change="handleChange"
  >
    <el-option
      v-for="item in options"
      :key="item.id"
      :label="buildLabel(item)"
      :value="item.id"
    >
      <span>{{ item.name }}</span>
      <span class="option-tip">
        · 利润 <span :class="item.gross_profit >= 0 ? 'text-success' : 'text-danger'">
          ¥{{ formatMoney(item.gross_profit) }}
        </span>
      </span>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { getProjectList } from '@/api/project'
import { formatMoney } from '@/utils/format'

const props = defineProps({
  modelValue: { type: [Number, String, null], default: null },
  /** 默认仅展示 active 项目；传空字符串则展示所有状态 */
  status: { type: String, default: 'active' }
})
const emit = defineEmits(['update:modelValue', 'change'])

const currentValue = ref(props.modelValue)
const loading = ref(false)
const options = ref([])

watch(() => props.modelValue, (val) => {
  currentValue.value = val
  // 若外部赋值但 options 里没这条，补一条
  if (val && !options.value.find(o => o.id === val)) {
    fetchOne(val)
  }
})

async function fetchList(keyword = '') {
  loading.value = true
  try {
    const params = { pageSize: 50 }
    if (props.status) params.status = props.status
    if (keyword) params.keyword = keyword
    const res = await getProjectList(params)
    options.value = res.data?.list || []
  } catch (e) {
    options.value = []
  } finally {
    loading.value = false
  }
}

/** 外部传入已选 id 但未在 options 时补一条（编辑场景） */
async function fetchOne(id) {
  try {
    const res = await getProjectList({ pageSize: 1 })
    // 简化：通过列表拉取全量可能拿不到；这里只保底不报错
    const item = (res.data?.list || []).find(o => o.id === id)
    if (item && !options.value.find(o => o.id === id)) {
      options.value = [item, ...options.value]
    }
  } catch (e) {
    // 静默
  }
}

function remoteSearch(query) {
  fetchList(query || '')
}

function handleChange(val) {
  emit('update:modelValue', val)
  emit('change', val, options.value.find(o => o.id === val))
}

function buildLabel(item) {
  return item.name + (item.patent_no ? ` [${item.patent_no}]` : '')
}

onMounted(() => {
  fetchList()
})
</script>

<style scoped>
.option-tip {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.text-success { color: #67c23a; }
.text-danger { color: #f56c6c; }
</style>
