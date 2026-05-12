<!--
  ============================================================
  收支趋势折线图（TrendChart）
  ============================================================
  用途：Dashboard 展示近 12 个月收入/支出双线对比趋势

  Props:
    - months  (Array<string>)  月份标签，如 ['2025-06', '2025-07', ...]
    - income  (Array<number>)  各月收入金额
    - expense (Array<number>)  各月支出金额

  技术要点：
    - 使用 ECharts 按需引入（只打包 LineChart + 必需组件），减小 bundle
    - 监听 props 变化自动重绘
    - 监听 window resize 自动自适应
    - 组件销毁时必须 dispose 图表实例，防止内存泄漏

  使用示例：
    <TrendChart :months="trend.months" :income="trend.income" :expense="trend.expense" />
  ============================================================
-->
<template>
  <div ref="chartRef" class="trend-chart"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 按需注册 ECharts 组件（全局注册，模块作用域即可）
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

const props = defineProps({
  months: { type: Array, default: () => [] },
  income: { type: Array, default: () => [] },
  expense: { type: Array, default: () => [] }
})

const chartRef = ref(null)
let chart = null // 图表实例，不使用 ref 避免 Vue 深度代理影响 ECharts 内部逻辑

/**
 * 渲染/更新图表配置
 */
function render() {
  if (!chart) return
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      // 自定义金额格式化（千分位 + 两位小数）
      valueFormatter: (v) => `¥ ${Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    },
    legend: { data: ['收入', '支出'], top: 0, right: 0 },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '16%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.months,
      axisLabel: { fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        // 万元级别简写，避免 y 轴标签过长
        formatter: (v) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v
      }
    },
    series: [
      {
        name: '收入',
        type: 'line',
        data: props.income,
        smooth: true,
        itemStyle: { color: '#67c23a' },
        areaStyle: { color: 'rgba(103, 194, 58, 0.1)' } // 面积填充增强视觉
      },
      {
        name: '支出',
        type: 'line',
        data: props.expense,
        smooth: true,
        itemStyle: { color: '#f56c6c' },
        areaStyle: { color: 'rgba(245, 108, 108, 0.1)' }
      }
    ]
  })
}

/** 容器尺寸变化时自适应 */
function handleResize() {
  chart && chart.resize()
}

onMounted(() => {
  chart = echarts.init(chartRef.value)
  render()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  // 组件销毁清理：移除事件 + dispose 图表避免内存泄漏
  window.removeEventListener('resize', handleResize)
  chart && chart.dispose()
  chart = null
})

// props 变化自动重绘
watch(() => [props.months, props.income, props.expense], render, { deep: true })
</script>

<style scoped>
.trend-chart {
  width: 100%;
  height: 320px;
}
</style>
