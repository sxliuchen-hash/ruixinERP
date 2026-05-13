<!--
  ============================================================
  员工档案管理页（EmployeeList）
  ============================================================
  功能：员工列表 + 新建/编辑 + 转正/离职 + 职级变更
  仅 admin 可见
  ============================================================
-->
<template>
  <div class="employee-container">
    <div class="page-header">
      <h3>员工档案</h3>
      <div class="header-actions">
        <el-select v-model="filterRole" placeholder="角色" clearable style="width: 120px" @change="fetchList">
          <el-option label="老板" value="boss" />
          <el-option label="合伙人" value="partner" />
          <el-option label="销售" value="sales" />
          <el-option label="采购" value="purchase" />
          <el-option label="内勤" value="admin" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px" @change="fetchList">
          <el-option label="试用" value="probation" />
          <el-option label="正式" value="regular" />
          <el-option label="离职" value="resigned" />
        </el-select>
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>新建员工
        </el-button>
      </div>
    </div>

    <el-table :data="employeeList" v-loading="loading" border stripe>
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column prop="role" label="角色" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="ROLE_MAP[row.role]?.type" size="small">
            {{ ROLE_MAP[row.role]?.label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="STATUS_MAP[row.status]?.type" size="small">
            {{ STATUS_MAP[row.status]?.label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="grade" label="职级" width="70" align="center">
        <template #default="{ row }">
          <span v-if="row.role === 'sales'">{{ row.grade }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="基础薪资" width="200">
        <template #default="{ row }">
          {{ row.base_salary }} + {{ row.position_allowance }} + {{ row.attendance_bonus }}
          = ¥{{ (parseFloat(row.base_salary) + parseFloat(row.position_allowance) + parseFloat(row.attendance_bonus)).toFixed(0) }}
        </template>
      </el-table-column>
      <el-table-column label="职级津贴" width="90" align="right">
        <template #default="{ row }">
          <span v-if="row.role === 'sales'">¥{{ GRADE_ALLOWANCE[row.grade] || 0 }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="hire_date" label="入职日期" width="110" align="center" />
      <el-table-column prop="region" label="区域" width="70" align="center" />
      <el-table-column prop="wechat_userid" label="企微ID" width="110" />
      <el-table-column label="操作" width="240" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button
            v-if="row.status === 'probation'"
            type="success" link size="small"
            @click="handleRegular(row)"
          >转正</el-button>
          <el-button
            v-if="row.status !== 'resigned'"
            type="warning" link size="small"
            @click="handleResign(row)"
          >离职</el-button>
          <el-button
            v-if="row.role === 'sales'"
            type="info" link size="small"
            @click="handleGradeChange(row)"
          >调级</el-button>
          <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑员工' : '新建员工'" width="600px" destroy-on-close>
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="formData.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="角色" prop="role">
              <el-select v-model="formData.role" style="width: 100%">
                <el-option label="老板" value="boss" />
                <el-option label="合伙人" value="partner" />
                <el-option label="销售顾问" value="sales" />
                <el-option label="采购" value="purchase" />
                <el-option label="内勤" value="admin" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="企微UserID">
              <el-input v-model="formData.wechat_userid" placeholder="如 LiuChen" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="关联用户ID">
              <el-input-number v-model="formData.user_id" :min="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="入职日期">
              <el-date-picker v-model="formData.hire_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区域">
              <el-input v-model="formData.region" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider>薪资结构</el-divider>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="基本工资">
              <el-input-number v-model="formData.base_salary" :min="0" :step="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="岗位补贴">
              <el-input-number v-model="formData.position_allowance" :min="0" :step="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="全勤奖">
              <el-input-number v-model="formData.attendance_bonus" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16" v-if="formData.role === 'partner'">
          <el-col :span="12">
            <el-form-item label="分成比例">
              <el-input-number v-model="formData.partner_share_rate" :min="0" :max="1" :step="0.1" :precision="2" style="width: 100%" />
              <div class="form-tip">0.7 表示 70%</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 调级弹窗 -->
    <el-dialog v-model="gradeDialogVisible" title="职级变更" width="400px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="当前职级">
          <el-tag>{{ currentEmployee?.grade }}</el-tag>
        </el-form-item>
        <el-form-item label="新职级">
          <el-select v-model="newGrade" style="width: 100%">
            <el-option v-for="g in ['A','B','C','D','E']" :key="g" :label="`${g} (津贴 ¥${GRADE_ALLOWANCE[g]})`" :value="g" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="gradeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitGradeChange">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getEmployeeList, createEmployee, updateEmployee, deleteEmployee, changeGrade, changeStatus } from '@/api/employee'

const ROLE_MAP = {
  boss: { label: '老板', type: 'danger' },
  partner: { label: '合伙人', type: 'warning' },
  sales: { label: '销售', type: 'success' },
  purchase: { label: '采购', type: '' },
  admin: { label: '内勤', type: 'info' }
}

const STATUS_MAP = {
  probation: { label: '试用', type: 'warning' },
  regular: { label: '正式', type: 'success' },
  resigned: { label: '离职', type: 'info' }
}

const GRADE_ALLOWANCE = { A: 0, B: 200, C: 500, D: 900, E: 1400 }

const loading = ref(false)
const employeeList = ref([])
const filterRole = ref('')
const filterStatus = ref('')

const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentEmployee = ref(null)

const formData = reactive({
  name: '', role: 'sales', user_id: null, wechat_userid: '',
  hire_date: null, region: '西安',
  base_salary: 2400, position_allowance: 1000, attendance_bonus: 100,
  partner_share_rate: 0, remark: ''
})

const formRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

const gradeDialogVisible = ref(false)
const newGrade = ref('A')

async function fetchList() {
  loading.value = true
  try {
    const params = {}
    if (filterRole.value) params.role = filterRole.value
    if (filterStatus.value) params.status = filterStatus.value
    const res = await getEmployeeList(params)
    employeeList.value = res.data || []
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function handleCreate() {
  isEdit.value = false
  Object.assign(formData, { name: '', role: 'sales', user_id: null, wechat_userid: '', hire_date: null, region: '西安', base_salary: 2400, position_allowance: 1000, attendance_bonus: 100, partner_share_rate: 0, remark: '' })
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  currentEmployee.value = row
  Object.assign(formData, { ...row, partner_share_rate: parseFloat(row.partner_share_rate) || 0 })
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updateEmployee(currentEmployee.value.id, formData)
      ElMessage.success('更新成功')
    } else {
      await createEmployee(formData)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
  } catch (e) {} finally { submitLoading.value = false }
}

async function handleRegular(row) {
  try {
    await ElMessageBox.confirm(`确定将 ${row.name} 转为正式员工？`, '转正确认', { type: 'warning' })
    await changeStatus(row.id, { status: 'regular', regular_date: new Date().toISOString().slice(0, 10) })
    ElMessage.success('已转正')
    fetchList()
  } catch (e) {}
}

async function handleResign(row) {
  try {
    await ElMessageBox.confirm(`确定将 ${row.name} 标记为离职？`, '离职确认', { type: 'warning' })
    await changeStatus(row.id, { status: 'resigned', resign_date: new Date().toISOString().slice(0, 10) })
    ElMessage.success('已标记离职')
    fetchList()
  } catch (e) {}
}

function handleGradeChange(row) {
  currentEmployee.value = row
  newGrade.value = row.grade
  gradeDialogVisible.value = true
}

async function submitGradeChange() {
  try {
    await changeGrade(currentEmployee.value.id, newGrade.value)
    ElMessage.success(`职级已变更为 ${newGrade.value}`)
    gradeDialogVisible.value = false
    fetchList()
  } catch (e) {}
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除员工 ${row.name}？`, '提示', { type: 'warning' })
    await deleteEmployee(row.id)
    ElMessage.success('已删除')
    fetchList()
  } catch (e) {}
}

onMounted(fetchList)
</script>

<style scoped lang="scss">
.employee-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  h3 { margin: 0; font-size: 18px; color: #303133; }
}
.header-actions { display: flex; gap: 12px; }
.form-tip { font-size: 12px; color: #909399; margin-top: 4px; }
</style>
