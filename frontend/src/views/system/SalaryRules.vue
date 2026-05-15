<template>
  <div class="salary-rules-container">
    <div class="page-header">
      <h3>薪资规则配置</h3>
      <el-button type="primary" @click="handleInit" :loading="initLoading">
        初始化默认规则
      </el-button>
    </div>

    <el-tabs v-model="activeTab" v-loading="loading">
      <!-- 销售提成 -->
      <el-tab-pane label="销售提成" name="commission">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>超额累进提成阶梯</span>
              <div>
                <el-button size="small" @click="resetRule('commission')">恢复默认</el-button>
                <el-button size="small" type="primary" @click="saveRule('commission')">保存</el-button>
              </div>
            </div>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 16px">
            超额累进：每档只对超出部分按该档费率计算。例如月毛利4万 = 15000×10% + 15000×15% + 10000×18% = 5550元
          </el-alert>
          <el-table :data="commissionTiers" border size="small">
            <el-table-column label="区间下限(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.min" :min="0" :step="5000" size="small" style="width: 120px" />
              </template>
            </el-table-column>
            <el-table-column label="区间上限(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.max" :min="0" :step="5000" size="small" style="width: 120px" :disabled="row.max === null" />
                <el-checkbox v-model="row.noLimit" size="small" style="margin-left: 8px" @change="v => row.max = v ? null : 100000">
                  无上限
                </el-checkbox>
              </template>
            </el-table-column>
            <el-table-column label="提成费率" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.rate" :min="0" :max="1" :step="0.01" :precision="2" size="small" style="width: 100px" />
              </template>
            </el-table-column>
            <el-table-column label="说明" prop="label">
              <template #default="{ row }">
                <el-input v-model="row.label" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link size="small" @click="commissionTiers.splice($index, 1)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button style="margin-top: 12px" size="small" @click="addCommissionTier">+ 添加档位</el-button>

          <!-- 提成试算 -->
          <el-divider>提成试算</el-divider>
          <el-row :gutter="16" align="middle">
            <el-col :span="8">
              <el-input-number v-model="trialAmount" :min="0" :step="5000" placeholder="输入月毛利" style="width: 100%" />
            </el-col>
            <el-col :span="4">
              <el-button type="primary" @click="calcTrial">计算</el-button>
            </el-col>
            <el-col :span="12">
              <div v-if="trialResult !== null" class="trial-result">
                提成 = <strong>¥{{ trialResult.toLocaleString() }}</strong>
                （费率 {{ trialRate }}%）
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-tab-pane>

      <!-- 职级津贴 -->
      <el-tab-pane label="职级津贴" name="grade">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>职级考核与津贴标准</span>
              <div>
                <el-button size="small" @click="resetRule('grade')">恢复默认</el-button>
                <el-button size="small" type="primary" @click="saveRule('grade')">保存</el-button>
              </div>
            </div>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 16px">
            季度考核：每年3/6/9/12月考核上一季度数据。达到目标即享受该档津贴，下月生效。
          </el-alert>
          <el-table :data="gradeItems" border size="small">
            <el-table-column label="职级" width="80" align="center" prop="grade" />
            <el-table-column label="名称" width="100">
              <template #default="{ row }">
                <el-input v-model="row.label" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="季度毛利下限(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.quarterly_min" :min="0" :step="10000" size="small" style="width: 140px" />
              </template>
            </el-table-column>
            <el-table-column label="季度毛利上限(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.quarterly_max" :min="0" :step="10000" size="small" style="width: 140px" :disabled="row.quarterly_max === null" />
              </template>
            </el-table-column>
            <el-table-column label="月津贴(元)" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.allowance" :min="0" :step="100" size="small" style="width: 100px" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 社保公积金 -->
      <el-tab-pane label="社保公积金" name="social_insurance">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>社保公积金参数</span>
              <div>
                <el-button size="small" @click="resetRule('social_insurance')">恢复默认</el-button>
                <el-button size="small" type="primary" @click="saveRule('social_insurance')">保存</el-button>
              </div>
            </div>
          </template>
          <el-form label-width="120px" style="max-width: 500px">
            <el-form-item label="缴费基数(元)">
              <el-input-number v-model="socialData.base" :min="0" :step="100" style="width: 200px" />
              <span class="form-tip">西安最低工资标准</span>
            </el-form-item>
          </el-form>
          <el-table :data="socialData.items" border size="small" style="max-width: 500px">
            <el-table-column prop="name" label="项目" width="150" />
            <el-table-column label="个人缴纳比例" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.rate" :min="0" :max="0.5" :step="0.005" :precision="3" size="small" style="width: 120px" />
              </template>
            </el-table-column>
            <el-table-column label="月扣除(元)">
              <template #default="{ row }">
                ¥{{ (socialData.base * row.rate).toFixed(2) }}
              </template>
            </el-table-column>
          </el-table>
          <div class="social-total">
            合计个人月扣除：<strong>¥{{ socialTotal.toFixed(2) }}</strong>
            （比例 {{ (socialData.items.reduce((s, i) => s + i.rate, 0) * 100).toFixed(1) }}%）
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 采购提成 -->
      <el-tab-pane label="采购提成" name="purchase_commission">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>采购专利卖出提成</span>
              <div>
                <el-button size="small" @click="resetRule('purchase_commission')">恢复默认</el-button>
                <el-button size="small" type="primary" @click="saveRule('purchase_commission')">保存</el-button>
              </div>
            </div>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 16px">
            采购的专利被卖出时，按卖出时间距采购时间计算提成。时间越短提成越高。
          </el-alert>
          <el-table :data="purchaseTiers" border size="small">
            <el-table-column label="时间区间" prop="label" width="120" />
            <el-table-column label="天数下限" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.days_min" :min="0" size="small" style="width: 80px" />
              </template>
            </el-table-column>
            <el-table-column label="天数上限" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.days_max" :min="0" size="small" style="width: 80px" :disabled="row.days_max === null" />
              </template>
            </el-table-column>
            <el-table-column label="发明专利(元/件)" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.invention" :min="0" :step="25" size="small" style="width: 110px" />
              </template>
            </el-table-column>
            <el-table-column label="实用新型(元/件)" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.utility" :min="0" :step="5" :precision="2" size="small" style="width: 110px" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 通用参数 -->
      <el-tab-pane label="通用参数" name="general">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>通用薪资参数</span>
              <div>
                <el-button size="small" @click="resetRule('general')">恢复默认</el-button>
                <el-button size="small" type="primary" @click="saveRule('general')">保存</el-button>
              </div>
            </div>
          </template>
          <el-form label-width="160px" style="max-width: 500px">
            <el-form-item label="月计薪天数">
              <el-input-number v-model="generalData.work_days_per_month" :min="20" :max="23" :step="0.25" :precision="2" />
              <span class="form-tip">法定标准 21.75</span>
            </el-form-item>
            <el-form-item label="全勤奖(元)">
              <el-input-number v-model="generalData.attendance_bonus" :min="0" :step="50" />
            </el-form-item>
            <el-form-item label="全勤规则">
              <el-input v-model="generalData.attendance_rule" />
            </el-form-item>
            <el-form-item label="实习生月薪合计(元)">
              <el-input-number v-model="generalData.probation_total" :min="0" :step="100" />
            </el-form-item>
            <el-form-item label="正式员工基础合计(元)">
              <el-input-number v-model="generalData.regular_base" :min="0" :step="100" />
              <span class="form-tip">基本工资+岗位补贴+全勤</span>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAllSalaryRules, initSalaryRules, updateSalaryRule, resetSalaryRule } from '@/api/salaryRule'

const loading = ref(false)
const initLoading = ref(false)
const activeTab = ref('commission')

// 各规则数据
const commissionTiers = ref([])
const gradeItems = ref([])
const socialData = reactive({ base: 2120, items: [], total_rate: 0.153 })
const purchaseTiers = ref([])
const generalData = reactive({
  work_days_per_month: 21.75,
  attendance_bonus: 100,
  attendance_rule: '有请假即取消全勤',
  probation_total: 2000,
  regular_base: 3500
})

// 提成试算
const trialAmount = ref(40000)
const trialResult = ref(null)
const trialRate = ref(0)

// 社保合计
const socialTotal = computed(() => {
  return socialData.items.reduce((sum, item) => sum + socialData.base * item.rate, 0)
})

async function fetchRules() {
  loading.value = true
  try {
    const res = await getAllSalaryRules()
    const rules = res.data?.data || res.data || []
    rules.forEach(rule => {
      const data = typeof rule.rule_data === 'string' ? JSON.parse(rule.rule_data) : rule.rule_data
      switch (rule.rule_type) {
        case 'commission':
          commissionTiers.value = data.tiers.map(t => ({ ...t, noLimit: t.max === null }))
          break
        case 'grade':
          gradeItems.value = data.grades || []
          break
        case 'social_insurance':
          socialData.base = data.base
          socialData.items = data.items || []
          socialData.total_rate = data.total_rate
          break
        case 'purchase_commission':
          purchaseTiers.value = data.tiers || []
          break
        case 'general':
          Object.assign(generalData, data)
          break
      }
    })
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
    ElMessage.success(res.data?.message || '初始化完成')
    fetchRules()
  } catch (e) {
    ElMessage.error('初始化失败')
  } finally {
    initLoading.value = false
  }
}

async function saveRule(type) {
  let rule_data
  switch (type) {
    case 'commission':
      rule_data = {
        mode: 'progressive',
        tiers: commissionTiers.value.map(t => ({
          min: t.min,
          max: t.noLimit ? null : t.max,
          rate: t.rate,
          label: t.label
        }))
      }
      break
    case 'grade':
      rule_data = {
        grades: gradeItems.value,
        evaluation_months: [3, 6, 9, 12],
        effective_delay: 1
      }
      break
    case 'social_insurance':
      rule_data = {
        base: socialData.base,
        items: socialData.items,
        total_rate: parseFloat(socialData.items.reduce((s, i) => s + i.rate, 0).toFixed(4))
      }
      break
    case 'purchase_commission':
      rule_data = { tiers: purchaseTiers.value }
      break
    case 'general':
      rule_data = { ...generalData }
      break
  }

  try {
    await updateSalaryRule(type, { rule_data })
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

async function resetRule(type) {
  try {
    await ElMessageBox.confirm('确定恢复为默认值？当前修改将丢失。', '提示', { type: 'warning' })
    await resetSalaryRule(type)
    ElMessage.success('已恢复默认')
    fetchRules()
  } catch (e) {}
}

function addCommissionTier() {
  const last = commissionTiers.value[commissionTiers.value.length - 1]
  commissionTiers.value.push({
    min: last ? (last.max || last.min + 10000) : 0,
    max: null,
    rate: 0.1,
    label: '',
    noLimit: true
  })
}

function calcTrial() {
  const amount = trialAmount.value || 0
  let commission = 0
  let prev = 0
  for (const tier of commissionTiers.value) {
    const limit = tier.noLimit ? Infinity : (tier.max || Infinity)
    const taxable = Math.min(amount, limit) - prev
    if (taxable <= 0) break
    commission += taxable * tier.rate
    prev = limit
    if (amount <= limit) break
  }
  trialResult.value = parseFloat(commission.toFixed(2))
  trialRate.value = amount > 0 ? parseFloat((commission / amount * 100).toFixed(2)) : 0
}

onMounted(fetchRules)
</script>

<style scoped lang="scss">
.salary-rules-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #303133;
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
}

.social-total {
  margin-top: 12px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 14px;
}

.trial-result {
  padding: 8px 12px;
  background: #f0f9eb;
  border-radius: 4px;
  color: #67c23a;
  font-size: 14px;
}
</style>
