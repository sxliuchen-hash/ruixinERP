<!--
  ============================================================
  通用导出按钮（ExportButton）
  ============================================================
  用法：
    <ExportButton
      path="/export/payments"
      :params="{ type: filterType, start_date: filterStart }"
      label="导出收付款"
    />

  功能：
    - 点击后自动触发下载
    - 使用 Authorization Bearer 携带 token
    - 文件名从 Content-Disposition 解析
    - 下载期间按钮 loading
    - 二次确认（可选）
  ============================================================
-->
<template>
  <el-button
    :type="type"
    :size="size"
    :loading="loading"
    :plain="plain"
    @click="handleClick"
  >
    <el-icon v-if="!loading"><Download /></el-icon>
    {{ label }}
  </el-button>
</template>

<script setup>
import { ref } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { downloadExcel } from '@/api/export'

const props = defineProps({
  /** 导出路径（相对 /api/v1） */
  path: { type: String, required: true },
  /** 查询参数对象 */
  params: { type: Object, default: () => ({}) },
  /** 按钮文案 */
  label: { type: String, default: '导出 Excel' },
  /** 按钮类型 */
  type: { type: String, default: 'default' },
  /** 按钮尺寸 */
  size: { type: String, default: 'default' },
  /** 朴素风格 */
  plain: { type: Boolean, default: false },
  /** 点击后是否弹出二次确认 */
  confirm: { type: Boolean, default: false }
})

const loading = ref(false)

async function handleClick() {
  if (props.confirm) {
    try {
      await ElMessageBox.confirm(
        `将按当前筛选条件导出数据，最多 5000 条。继续？`,
        '导出确认',
        { type: 'info' }
      )
    } catch {
      return
    }
  }

  loading.value = true
  try {
    await downloadExcel(props.path, props.params)
  } catch (e) {
    // 错误已在 downloadExcel 内提示
  } finally {
    loading.value = false
  }
}
</script>
