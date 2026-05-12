<!--
  ============================================================
  成本构成饼图（CostPieChart）
  ============================================================
  用途：Dashboard 展示费用类支出按成本类别的占比

  Props:
    - data (Array<{name: string, value: number}>)
        饼图切片数据，空数组时显示"暂无数据"的灰色占位圈

  设计亮点：
    - 环形饼图（内圈 45%，外圈 70%），中空区域更现代
    - hover 时切片放大并显示金额 + 百分比
    - 无数据时显示灰色占位，避免空白尴尬

  扩展点：
    - 可增加 total 插槽在中心显示合计
    - 可增加 click 事件实现钻取（点击切片跳转对应类别明细）
  ============================================================
-->
<template>
  <div ref="chartRef" class="cost-pie-chart"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps({
  data: { type: Array, default: () => [] }
})

const chartRef = ref(null)
let chart = null

function render() {
  if (!chart) return
  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${p.name}: ¥${Number(p.value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${p.percent}%)`
    },
    legend: { orient: 'vertical', left: 'left', top: 'middle' },
    series: [
      {
        name: '成本构成',
        type: 'pie',
        radius: ['45%', '70%'], // 环形
        center: ['60%', '50%'], // 向右偏移让图例有空间
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
        data: props.data.length
          ? props.data
          // 无数据时用灰色占位环，避免空白
          : [{ name: '暂无数据', value: 1, itemStyle: { color: '#e4e7ed' } }]
      }
    ]
  })
}

function handleResize() {
  chart && chart.resize()
}

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
.cost-pie-chart {
  width: 100%;
  height: 320px;
}
</style>
