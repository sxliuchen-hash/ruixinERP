<template>
  <div class="salary-rule-config">
    <div class="page-header">
      <h3>薪资规则配置</h3>
      <el-button type="primary" @click="handleInit" :loading="initLoading" v-if="isEmpty">
        初始化默认规则
      </el-button>
    </div>

    <el-tabs v-model="activeTab" v-loading="loading">
      <!-- 销售提成 -->
      <el-tab-pane label="销售提成" name="commission">
        <CommissionPanel
          :rule="rules.commission?.[0]"
          @save="handleSave"
        />
      </el-tab-pane>

      <!-- 职级津贴 -->
      <el-tab-pane label="职级津贴" name="grade">
        <GradePanel
          :rule="rules.grade?.[0]"
          @save="handleSave"
        />
      </el-tab-pane>

      <!-- 社保公积金 -->
      <el-tab-pane label="社保公积金" name="social_insurance">
        <SocialInsurancePanel
          :rules="rules.social_insurance || []"
          @save="handleSave"
        />
      </el-tab-pane>

      <!-- 采购提成 -->
      <el-tab-pane label="采购提成" name="purchase_commission">
        <PurchaseCommissionPanel
          :rule="rules.purchase_commission?.[0]"
          @save="handleSave"
        />
      </el-tab-pane>

      <!-- 通用参数 -->
      <el-tab-pane label="通用参数" name="general">
        <GeneralPanel
          :rules="rules.general || []"
          @save="handleSave"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSalaryRules, initSalaryRules, updateSalaryRule } from '@/api/salaryRule'
import CommissionPanel from './panels/CommissionPanel.vue'
import GradePanel from './panels/GradePanel.vue'
import SocialInsurancePanel from './panels/SocialInsurancePanel.vue'
import PurchaseCommissionPanel from './panels/PurchaseCommissionPanel.vue'
import GeneralPanel from './panels/GeneralPanel.vue'

const loading = ref(false)
const initLoading = ref(false)
const activeTab = ref('commission')
const rules = ref({})

const isEmpty = computed(() => Object.keys(rules.value).length === 0)

async function loadRules() {
  loading.value = true
  try {
    const res = await getSalaryRules()
    if (res.data?.success) {
      rules.value = res.data.data
    }
  } catch (e) {
    console.error('加载规则失败', e)
  } finally {
    loading.value = false
  }
}

async function handleInit() {
  initLoading.value = true
  try {
    const res = await initSalaryRules()
    if (res.data?.success) {
      ElMessage.success(res.data.data.message)
      await loadRules()
    }
  } catch (e) {
    ElMessage.error('初始化失败')
  } finally {
    initLoading.value = false
  }
}

async function handleSave(rule) {
  try {
    const res = await updateSalaryRule(rule.id, {
      rule_value: rule.rule_value,
      description: rule.description
    })
    if (res.data?.success) {
      ElMessage.success('保存成功')
      await loadRules()
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.message || e.message))
  }
}

onMounted(loadRules)
</script>

<style scoped lang="scss">
.salary-rule-config {
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    h3 {
      margin: 0;
      font-size: 18px;
    }
  }
}
</style>
