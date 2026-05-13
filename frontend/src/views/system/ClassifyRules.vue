<!--
  ============================================================
  归类规则管理页（ClassifyRules）
  ============================================================
  管理费用自动归类的关键词规则
  仅 admin 可见
  ============================================================
-->
<template>
  <div class="rules-container">
    <div class="page-header">
      <h3>归类规则</h3>
      <el-button type="primary" @click="handleCreate">
        <el-icon><Plus /></el-icon>新建规则
      </el-button>
    </div>

    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        归类规则用于自动识别付款摘要中的关键词，建议对应的成本类别。优先级数字越大越优先匹配。
      </template>
    </el-alert>

    <el-table :data="ruleList" v-loading="loading" border stripe size="small">
      <el-table-column prop="keyword" label="关键词" width="160" />
      <el-table-column prop="category_name" label="建议类别" width="140" />
      <el-table-column prop="category_type" label="大类" width="100" align="center" />
      <el-table-column prop="priority" label="优先级" width="80" align="center" />
      <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip />
      <el-table-column label="操作" width="140" align="center">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑规则' : '新建规则'" width="500px" destroy-on-close>
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
        <el-form-item label="关键词" prop="keyword">
          <el-input v-model="formData.keyword" placeholder="摘要中包含此关键词时触发" />
        </el-form-item>
        <el-form-item label="类别名称" prop="category_name">
          <el-input v-model="formData.category_name" placeholder="建议的成本类别名称" />
        </el-form-item>
        <el-form-item label="大类" prop="category_type">
          <el-select v-model="formData.category_type" style="width: 100%">
            <el-option label="人力" value="labor" />
            <el-option label="运营" value="operation" />
            <el-option label="专利" value="patent" />
            <el-option label="营销" value="marketing" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-input-number v-model="formData.priority" :min="0" :max="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'

const loading = ref(false)
const ruleList = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitLoading = ref(false)
const formRef = ref(null)
const currentRow = ref(null)

const formData = reactive({
  keyword: '',
  category_name: '',
  category_type: 'operation',
  priority: 10,
  remark: ''
})

const formRules = {
  keyword: [{ required: true, message: '请输入关键词', trigger: 'blur' }],
  category_name: [{ required: true, message: '请输入类别名称', trigger: 'blur' }],
  category_type: [{ required: true, message: '请选择大类', trigger: 'change' }]
}

async function fetchList() {
  loading.value = true
  try {
    const res = await request.get('/classify-rules')
    ruleList.value = res.data || []
  } catch (e) {
    // 接口可能还没实现，用空数组
    ruleList.value = []
  } finally {
    loading.value = false
  }
}

function handleCreate() {
  isEdit.value = false
  Object.assign(formData, { keyword: '', category_name: '', category_type: 'operation', priority: 10, remark: '' })
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  currentRow.value = row
  Object.assign(formData, row)
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitLoading.value = true
  try {
    if (isEdit.value) {
      await request.put(`/classify-rules/${currentRow.value.id}`, formData)
      ElMessage.success('更新成功')
    } else {
      await request.post('/classify-rules', formData)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchList()
  } catch (e) {
    // 拦截器已提示
  } finally {
    submitLoading.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm('确定删除该规则？', '提示', { type: 'warning' })
    await request.delete(`/classify-rules/${row.id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch (e) { /* 用户取消 */ }
}

onMounted(fetchList)
</script>

<style scoped lang="scss">
.rules-container {
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
</style>
