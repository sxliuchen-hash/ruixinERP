<!--
  ============================================================
  成本趋势堆叠柱状图（CostTrendChart）
  ============================================================
  数据格式（后端 /costs/summary/monthly 返回）：
    [
      { month: '2026-05', total: xxx, by_type: { labor: x, operation: y, ... } },
      ...
    ]

  展示：
    - 每月一根柱子，按大类堆叠（labor/operation/patent/marketing/other）
    - tooltip 显示月度总额和各大类明细
    - 颜色与 COST_CATEGORY_TYPE_MAP 一致
  ============================================================
-->
<template>
  <div ref="chartRef" class="cost-trend-chart"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
  TooltipComponent, LegendComponent, GridComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { COST_CATEGORY_TYPE_MAP } from '@/utils/constants'

echarts.use([BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer])

const props = defineProps({
  data: { type: Array, default: () => [] }
})

const chartRef = ref(null)
let chart = null

const TYPES = ['labor', 'operation', 'patent', 'marketing', 'other']

function render() {
  if (!chart) return

  const months = props.data.map(m => m.month)
  const series = TYPES.map(t => ({
    name: COST_CATEGORY_TYPE_MAP[t]?.label || t,
    type: 'bar',
    stack: 'total',
    itemStyle: { color: COST_CATEGORY_TYPE_MAP[t]?.color || '#909399' },
    data: props.data.map(m => parseFloat((m.by_type?.[t] || 0).toFixed(2))),
    emphasis: { focus: 'series' }
  }))

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        if (!params.length) return ''
        const month = params[0].axisValue
        const lines = [`<b>${month}</b>`]
        let total = 0
        params.forEach(p => {
          if (p.value > 0) {
            lines.push(
              `${p.marker} ${p.seriesName}：¥ ${Number(p.value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )
            total += Number(p.value)
          }
        })
        lines.push(`<b>合计：¥ ${Number(total).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>`)
        return lines.join('<br/>')
      }
    },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: { interval: 0, rotate: months.length > 6 ? 30 : 0 }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => v >= 10000 ? (v / 10000).toFixed(1) + '万' : v
      }
    },
    series
  }, true)
}

function handleResize() { chart && chart.resize() }

onMounted(() => {
  chart = echarts.init(chartRef.value)
  render()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart && chart.dispose()
  chart = null
})

watch(() => props.data, render, { deep: true })
</script>

<style scoped>
.cost-trend-chart {
  width: 100%;
  height: 300px;
}
</style>
