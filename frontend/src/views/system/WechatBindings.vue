<!--
  ============================================================
  企微配置状态页（WechatBindings）
  ============================================================
  展示企微集成配置状态 + 手动触发同步 + 用户 userid 查询
  仅 admin 可见
  ============================================================
-->
<template>
  <div class="wechat-container">
    <h3>企业微信集成</h3>

    <!-- 配置状态 -->
    <el-card shadow="never" style="margin-bottom: 20px">
      <template #header>配置状态</template>
      <el-descriptions :column="2" border size="small" v-if="config">
        <el-descriptions-item label="CorpID">{{ config.corp_id || '-' }}</el-descriptions-item>
        <el-descriptions-item label="AgentID">{{ config.agent_id || '-' }}</el-descriptions-item>
        <el-descriptions-item label="Secret">
          <el-tag :type="config.secret_configured ? 'success' : 'danger'" size="small">
            {{ config.secret_configured ? '已配置' : '未配置' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="Token">
          <el-tag :type="config.token_configured ? 'success' : 'danger'" size="small">
            {{ config.token_configured ? '已配置' : '未配置' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="AES Key">
          <el-tag :type="config.aes_key_configured ? 'success' : 'danger'" size="small">
            {{ config.aes_key_configured ? '已配置' : '未配置' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="回调就绪">
          <el-tag :type="config.callback_ready ? 'success' : 'warning'" size="small">
            {{ config.callback_ready ? '是' : '否' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
      <el-skeleton v-else :rows="3" animated />
    </el-card>

    <!-- 操作区 -->
    <el-card shadow="never" style="margin-bottom: 20px">
      <template #header>操作</template>
      <el-space wrap>
        <el-button type="primary" :loading="tokenLoading" @click="testToken">
          测试 access_token
        </el-button>
        <el-button type="success" :loading="syncLoading" @click="manualSync">
          手动同步审批（最近2小时）
        </el-button>
        <el-button type="warning" :loading="syncAllLoading" @click="manualSyncAll">
          同步最近24小时
        </el-button>
      </el-space>
      <div v-if="tokenResult" class="result-box">{{ tokenResult }}</div>
      <div v-if="syncResult" class="result-box">{{ syncResult }}</div>
    </el-card>

    <!-- 用户查询 -->
    <el-card shadow="never">
      <template #header>企微用户查询</template>
      <el-form inline>
        <el-form-item label="企微 UserID">
          <el-input v-model="queryUserId" placeholder="如 LiuChen" style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="userLoading" @click="queryUser">查询</el-button>
        </el-form-item>
      </el-form>
      <el-descriptions v-if="userInfo" :column="2" border size="small" style="margin-top: 12px">
        <el-descriptions-item label="UserID">{{ userInfo.userid }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ userInfo.name }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ userInfo.department?.join(', ') }}</el-descriptions-item>
        <el-descriptions-item label="职位">{{ userInfo.position || '-' }}</el-descriptions-item>
        <el-descriptions-item label="手机">{{ userInfo.mobile || '-' }}</el-descriptions-item>
        <el-descriptions-item label="邮箱">{{ userInfo.email || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ userInfo.status === 1 ? '已激活' : '未激活' }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="userError" class="error-text">{{ userError }}</div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'

const config = ref(null)
const tokenLoading = ref(false)
const tokenResult = ref('')
const syncLoading = ref(false)
const syncAllLoading = ref(false)
const syncResult = ref('')
const queryUserId = ref('')
const userLoading = ref(false)
const userInfo = ref(null)
const userError = ref('')

async function fetchConfig() {
  try {
    const res = await request.get('/wechat/config')
    config.value = res.data
  } catch (e) {
    console.error('获取配置失败', e)
  }
}

async function testToken() {
  tokenLoading.value = true
  tokenResult.value = ''
  try {
    const res = await request.get('/wechat/test-token')
    tokenResult.value = `✓ ${res.message} (长度: ${res.data?.length})`
  } catch (e) {
    tokenResult.value = `✗ ${e.response?.data?.message || e.message}`
  } finally {
    tokenLoading.value = false
  }
}

async function manualSync() {
  syncLoading.value = true
  syncResult.value = ''
  try {
    const res = await request.post('/wechat/sync', { hours: 2 })
    syncResult.value = `✓ ${res.message}`
    ElMessage.success(res.message)
  } catch (e) {
    syncResult.value = `✗ ${e.response?.data?.message || e.message}`
  } finally {
    syncLoading.value = false
  }
}

async function manualSyncAll() {
  syncAllLoading.value = true
  syncResult.value = ''
  try {
    const res = await request.post('/wechat/sync', { hours: 24 })
    syncResult.value = `✓ ${res.message}`
    ElMessage.success(res.message)
  } catch (e) {
    syncResult.value = `✗ ${e.response?.data?.message || e.message}`
  } finally {
    syncAllLoading.value = false
  }
}

async function queryUser() {
  if (!queryUserId.value) return
  userLoading.value = true
  userInfo.value = null
  userError.value = ''
  try {
    const res = await request.get(`/wechat/users/${queryUserId.value}`)
    userInfo.value = res.data
  } catch (e) {
    userError.value = e.response?.data?.message || e.message
  } finally {
    userLoading.value = false
  }
}

onMounted(fetchConfig)
</script>

<style scoped lang="scss">
.wechat-container {
  padding: 20px;
  background: #fff;
  border-radius: 4px;
  h3 { margin: 0 0 20px; font-size: 18px; color: #303133; }
}
.result-box {
  margin-top: 12px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
}
.error-text {
  margin-top: 12px;
  color: #f56c6c;
  font-size: 13px;
}
</style>
