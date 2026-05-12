<!--
  ============================================================
  项目利润资金流向图（ProfitSankey）
  ============================================================
  基于 ECharts Sankey 图展示：
    销售收入 → 采购成本
           → 税点成本
           → 维持成本
           → 利润 / 亏损

  Props:
    - flows: Array<{ from: string, to: string, value: number }>
      由后端 projectService.getProfitDetail 返回，格式直接对应

  设计：
    - 利润分支颜色根据 from 不同而不同（成本类偏灰/橙，利润偏绿）
    - 数值展示在连线上（金额千分位）
    - 左侧节点代表资金来源（销售收入），右侧节点代表用途
  ============================================================
-->
<template>
  <div ref="chartRef" class="profit-sankey"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { SankeyChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([SankeyChart, TooltipComponent, CanvasRenderer])

const props = defineProps({
  flows: { type: Array, default: () => [] }
})

const chartRef = ref(null)
let chart = null

/** 节点颜色映射（按语义配色） */
const NODE_COLORS = {
  '销售收入': '#409eff',
  '采购成本': '#909399',
  '税点成本': '#e6a23c',
  '维持成本': '#f56c6c',
  '利润': '#67c23a',
  '亏损': '#f56c6c'
}

function render() {
  if (!chart) return

  // 从 flows 中抽取所有节点
  const nodeSet = new Set()
  props.flows.forEach(f => {
    nodeSet.add(f.from)
    nodeSet.add(f.to)
  })
  const nodes = Array.from(nodeSet).map(name => ({
    name,
    itemStyle: { color: NODE_COLORS[name] || '#909399' }
  }))

  // 金额格式化
  const fmt = (v) => Number(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })

  chart.setOption({
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter: (p) => {
        if (p.dataType === 'edge') {
          return `${p.data.source} → ${p.data.target}<br/>¥ ${fmt(p.data.value)}`
        }
        return `${p.name}`
      }
    },
    series: [{
      type: 'sankey',
      left: 40,
      right: 100,
      top: 20,
      bottom: 20,
      nodeWidth: 20,
      nodeGap: 10,
      emphasis: { focus: 'adjacency' },
      data: nodes,
      links: props.flows.map(f => ({
        source: f.from,
        target: f.to,
        value: f.value
      })),
      lineStyle: { color: 'gradient', curveness: 0.5 },
      label: {
        formatter: (p) => `${p.name}`,
        fontSize: 12,
        color: '#303133'
      }
    }]
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

watch(() => props.flows, render, { deep: true })
</script>

<style scoped>
.profit-sankey {
  width: 100%;
  height: 360px;
}
</style>
