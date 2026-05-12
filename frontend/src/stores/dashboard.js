import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useDashboardStore = defineStore('dashboard', () => {
  // Dashboard 数据缓存
  const overview = ref(null)
  const accounts = ref([])
  const trend = ref(null)
  const costBreakdown = ref(null)
  const inventoryOverview = ref(null)
  const pendingCount = ref(0)
  const aging = ref(null)

  // 上次刷新时间
  const lastRefreshed = ref(null)

  function setOverview(data) {
    overview.value = data
    lastRefreshed.value = new Date()
  }

  function setAccounts(data) {
    accounts.value = data
  }

  function setTrend(data) {
    trend.value = data
  }

  function setCostBreakdown(data) {
    costBreakdown.value = data
  }

  function setInventoryOverview(data) {
    inventoryOverview.value = data
  }

  function setPendingCount(count) {
    pendingCount.value = count
  }

  function setAging(data) {
    aging.value = data
  }

  function clearCache() {
    overview.value = null
    accounts.value = []
    trend.value = null
    costBreakdown.value = null
    inventoryOverview.value = null
    pendingCount.value = 0
    aging.value = null
    lastRefreshed.value = null
  }

  return {
    overview,
    accounts,
    trend,
    costBreakdown,
    inventoryOverview,
    pendingCount,
    aging,
    lastRefreshed,
    setOverview,
    setAccounts,
    setTrend,
    setCostBreakdown,
    setInventoryOverview,
    setPendingCount,
    setAging,
    clearCache
  }
})
