<template>
  <div ref="containerRef" class="watermark-wrapper">
    <slot />
    <div ref="watermarkRef" class="watermark-layer"></div>
  </div>
</template>

<script setup>
/**
 * ============================================================
 * 防泄露水印组件（Watermark）
 * ============================================================
 * 用于工资条、业绩看板等敏感页面，叠加显示当前登录用户信息，
 * 一旦被截图/拍照外传，可追溯到泄露源头。
 *
 * 【实现要点】
 *   - 用 Canvas 生成平铺水印图，作为容器背景（repeat）
 *   - 文案默认取「真实姓名/账号 + 手机尾号 + 当前日期」
 *   - pointer-events:none 不影响页面交互
 *   - MutationObserver 防止用户在 DevTools 删除水印 DOM
 *
 * 【用法】
 *   <Watermark>
 *     ...敏感内容...
 *   </Watermark>
 *   可选 props: text（覆盖默认文案）、gap、fontSize、opacity
 * ============================================================
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  // 自定义水印文案；不传则用当前用户信息
  text: { type: String, default: '' },
  // 每块水印的横/纵间距
  gapX: { type: Number, default: 180 },
  gapY: { type: Number, default: 140 },
  fontSize: { type: Number, default: 14 },
  // 文字颜色透明度
  opacity: { type: Number, default: 0.12 },
  // 旋转角度（度）
  rotate: { type: Number, default: -22 }
})

const userStore = useUserStore()
const containerRef = ref(null)
const watermarkRef = ref(null)
let observer = null

/**
 * 默认水印文案：姓名(账号) + 手机尾号 + 日期
 */
const watermarkText = computed(() => {
  if (props.text) return props.text
  const info = userStore.userInfo || {}
  const name = info.realName || info.username || '未知用户'
  const account = info.username ? `@${info.username}` : ''
  const phone = info.phone ? String(info.phone) : ''
  const phoneTail = phone ? `尾号${phone.slice(-4)}` : ''
  const today = new Date().toLocaleDateString('zh-CN')
  // 两行文案：第一行身份，第二行手机尾号+日期
  return [`${name}${account}`, `${phoneTail} ${today}`.trim()].filter(Boolean)
})

/**
 * 生成水印背景图（dataURL）
 */
function genWatermarkUrl() {
  const lines = Array.isArray(watermarkText.value) ? watermarkText.value : [watermarkText.value]
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  const tileW = props.gapX
  const tileH = props.gapY
  canvas.width = tileW * dpr
  canvas.height = tileH * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  ctx.translate(tileW / 2, tileH / 2)
  ctx.rotate((props.rotate * Math.PI) / 180)
  ctx.font = `${props.fontSize}px -apple-system, "Microsoft YaHei", sans-serif`
  ctx.fillStyle = `rgba(0, 0, 0, ${props.opacity})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lineHeight = props.fontSize + 4
  const startY = -((lines.length - 1) * lineHeight) / 2
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, startY + i * lineHeight)
  })

  return canvas.toDataURL('image/png')
}

/**
 * 应用水印背景
 */
function applyWatermark() {
  const el = watermarkRef.value
  if (!el) return
  const url = genWatermarkUrl()
  el.style.backgroundImage = `url("${url}")`
  el.style.backgroundRepeat = 'repeat'
}

/**
 * 防篡改：监听水印层被删除或样式被改，自动恢复
 */
function guardWatermark() {
  if (!containerRef.value) return
  observer = new MutationObserver(() => {
    const el = watermarkRef.value
    if (!el || !containerRef.value.contains(el)) {
      // 水印层被删除 → 重新插入
      if (containerRef.value && watermarkRef.value) {
        containerRef.value.appendChild(watermarkRef.value)
      }
      return
    }
    // 背景被清空 → 重新应用
    if (!el.style.backgroundImage || el.style.display === 'none' || el.style.visibility === 'hidden') {
      el.style.display = ''
      el.style.visibility = ''
      applyWatermark()
    }
  })
  observer.observe(containerRef.value, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  })
}

onMounted(() => {
  applyWatermark()
  guardWatermark()
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
})

// 用户信息或文案变化时重绘
watch([watermarkText], () => applyWatermark())
</script>

<style scoped>
.watermark-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.watermark-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}
</style>
