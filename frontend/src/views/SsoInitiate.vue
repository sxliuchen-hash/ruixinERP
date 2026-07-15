<template>
  <div class="sso-initiate">
    <el-card class="initiate-card" shadow="always">
      <div
        v-if="status === 'loading'"
        class="status-content"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <el-icon class="loading-icon" :size="44"><Loading /></el-icon>
        <h2>正在发起安全登录</h2>
        <p>ERP 正在创建一次性登录状态，即将前往主项目完成授权。</p>
      </div>

      <div v-else class="status-content" role="alert" aria-live="assertive">
        <el-icon class="error-icon" :size="44"><WarningFilled /></el-icon>
        <h2>无法发起登录</h2>
        <p>{{ errorMessage }}</p>
        <div class="actions">
          <el-button type="primary" @click="startSso">重新尝试</el-button>
          <el-button @click="router.replace('/login')">查看登录选项</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import { initiateSso } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { normalizeLocalRedirect } from '@/utils/authNavigation'
import { normalizeExternalHttpUrl } from '@/utils/externalNavigation'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const mainSystemUrl = normalizeExternalHttpUrl(import.meta.env.VITE_MAIN_SYSTEM_URL)
const mainSystemOrigin = mainSystemUrl ? new URL(mainSystemUrl).origin : ''

const status = ref('loading')
const errorMessage = ref('')

function isValidState(state) {
  return typeof state === 'string'
    && /^[A-Za-z0-9_-]{32,200}$/.test(state)
}

function normalizeContinueUrl(rawUrl, expectedState) {
  // continue 是浏览器即将离开 ERP 的唯一外跳点。除固定路径和参数外，
  // 还必须与部署时显式配置的主项目 Origin 完全一致；配置缺失或
  // 无法得到有效 Origin 时默认拒绝。
  if (!mainSystemOrigin) return ''
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return ''
  try {
    const url = new URL(rawUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (url.username || url.password || url.hash) return ''
    if (url.origin !== mainSystemOrigin) return ''
    if (url.pathname !== '/sso/continue') return ''
    if (url.searchParams.getAll('app').length !== 1) return ''
    if (url.searchParams.get('app') !== 'erp') return ''
    if (url.searchParams.getAll('state').length !== 1) return ''
    if (url.searchParams.get('state') !== expectedState) return ''

    const queryKeys = [...url.searchParams.keys()].sort()
    if (queryKeys.length !== 2 || queryKeys[0] !== 'app' || queryKeys[1] !== 'state') return ''
    return url.href
  } catch {
    return ''
  }
}

function resolveInitiateErrorMessage(error) {
  const responseStatus = Number(error.response?.status || 0)
  if (error.code === 'INVALID_INITIATE_RESPONSE') return error.message
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return '创建登录状态超时，请检查网络后重新尝试。'
  }
  if (!error.response) return '暂时无法连接 ERP 登录服务，请检查网络后重试。'
  if (responseStatus === 429) return '登录请求过于频繁，请稍后再试。'
  if ([500, 502, 503, 504].includes(responseStatus)) {
    return 'ERP 登录服务暂时不可用，请稍后重试。'
  }
  return error.response?.data?.message || error.message || '无法创建安全登录状态。'
}

async function startSso() {
  status.value = 'loading'
  errorMessage.value = ''
  // 发起新 SSO 时不沿用旧 ERP 身份；state 由后端绑定到 HttpOnly Cookie。
  userStore.clearAuth()

  try {
    const redirect = normalizeLocalRedirect(route.query.redirect)
    const response = await initiateSso(redirect ? { redirect } : {})
    const state = response.data?.state
    if (!isValidState(state)) {
      throw Object.assign(new Error('ERP 登录服务返回了无效的 state，已停止跳转。'), {
        code: 'INVALID_INITIATE_RESPONSE'
      })
    }
    const redirectUrl = normalizeContinueUrl(response.data?.redirectUrl, state)
    if (!redirectUrl) {
      throw Object.assign(new Error('ERP 登录服务返回了无效的主项目跳转地址，已停止跳转。'), {
        code: 'INVALID_INITIATE_RESPONSE'
      })
    }

    window.location.assign(redirectUrl)
  } catch (error) {
    userStore.clearAuth()
    status.value = 'error'
    errorMessage.value = resolveInitiateErrorMessage(error)
  }
}

onMounted(startSso)
</script>

<style scoped lang="scss">
.sso-initiate {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.initiate-card {
  width: min(460px, 100%);
  border: 0;
  border-radius: 12px;
}

.status-content {
  padding: 28px 18px;
  text-align: center;

  h2 {
    margin: 16px 0 10px;
    color: #303133;
  }

  p {
    margin: 0;
    line-height: 1.7;
    color: #606266;
  }
}

.loading-icon {
  color: #409eff;
  animation: rotating 1.5s linear infinite;
}

.error-icon { color: #e6a23c; }

.actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
