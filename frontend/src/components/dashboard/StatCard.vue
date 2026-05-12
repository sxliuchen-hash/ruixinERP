<!--
  ============================================================
  Dashboard 指标卡片（StatCard）
  ============================================================
  用途：在 Dashboard 首页展示核心财务指标，如现金流入/流出、应收应付等

  Props:
    - label    (String,  required)  指标名称，如"现金流入"
    - value    (Number,  default=0) 指标数值
    - subtitle (String,  default='') 副标题（可显示占比/细分数据）
    - prefix   (String,  default='¥ ') 数值前缀，货币默认 ¥；计数场景传 ''
    - icon     (Component) Element Plus 图标组件
    - color    (String,  default='primary') 主题色：primary/success/danger/warning/info

  颜色语义：
    primary  - 中性（如总余额）
    success  - 正向（如现金流入、正利润）
    danger   - 负向（如现金流出、负利润）
    warning  - 警示（如待确认数量、应收应付）
    info     - 信息（如账户数）

  扩展点：
    - 可增加 trend 属性显示同比/环比小箭头
    - 可增加 clickable 属性使卡片可点击跳转详情页
  ============================================================
-->
<template>
  <div class="stat-card" :class="`stat-card--${color}`">
    <div class="stat-card__icon">
      <el-icon :size="28"><component :is="icon" /></el-icon>
    </div>
    <div class="stat-card__content">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value">{{ prefix }}{{ formatted }}</div>
      <div v-if="subtitle" class="stat-card__subtitle">{{ subtitle }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatMoney } from '@/utils/format'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: 0 },
  subtitle: { type: String, default: '' },
  prefix: { type: String, default: '¥ ' },
  icon: { type: [String, Object], default: 'Money' },
  color: { type: String, default: 'primary' }
})

// 数值格式化：千分位 + 两位小数，统一由 utils/format 处理
const formatted = computed(() => formatMoney(props.value))
</script>

<style scoped lang="scss">
.stat-card {
  display: flex;
  align-items: center;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  border-left: 4px solid var(--el-color-primary); // 左侧主题色条
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }

  &__icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(64, 158, 255, 0.1);
    color: var(--el-color-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 16px;
    flex-shrink: 0;
  }

  &__content {
    flex: 1;
    overflow: hidden;
  }

  &__label {
    font-size: 13px;
    color: #909399;
    margin-bottom: 6px;
  }

  &__value {
    font-size: 22px;
    font-weight: 600;
    color: #303133;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__subtitle {
    font-size: 12px;
    color: #c0c4cc;
    margin-top: 4px;
  }

  // BEM 修饰符，对应 props.color
  &--success {
    border-left-color: var(--el-color-success);
    .stat-card__icon {
      background: rgba(103, 194, 58, 0.1);
      color: var(--el-color-success);
    }
  }

  &--danger {
    border-left-color: var(--el-color-danger);
    .stat-card__icon {
      background: rgba(245, 108, 108, 0.1);
      color: var(--el-color-danger);
    }
  }

  &--warning {
    border-left-color: var(--el-color-warning);
    .stat-card__icon {
      background: rgba(230, 162, 60, 0.1);
      color: var(--el-color-warning);
    }
  }

  &--info {
    border-left-color: var(--el-color-info);
    .stat-card__icon {
      background: rgba(144, 147, 153, 0.1);
      color: var(--el-color-info);
    }
  }
}
</style>
