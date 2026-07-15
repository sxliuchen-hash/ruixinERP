<template>
  <div class="sso-callback">
    <el-card class="callback-card" shadow="always">
      <div
        v-if="status === 'loading'"
        class="status-content"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <el-icon class="loading-icon" :size="44"><Loading /></el-icon>
        <h2>正在进入 ERP</h2>
        <p>正在验证主项目的一次性授权，请稍候。</p>
      </div>

      <div v-else class="status-content" role="alert" aria-live="assertive">
        <el-icon class="error-icon" :size="44"><WarningFilled /></el-icon>
        <h2>无法完成登录</h2>
        <p>{{ errorMessage }}</p>
        <div class="actions">
          <el-button type="primary" @click="retrySso">
            重新发起安全登录
          </el-button>
          <el-button v-if="mainSystemUrl" @click="openMainSystem">返回主项目</el-button>
          <el-button @click="openLoginPage">查看登录选项</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { resolvePostAuthRedirect } from '@/utils/authNavigation'
import { assignExternalHttpUrl, normalizeExternalHttpUrl } from '@/utils/externalNavigation'

const mainSystemUrl = normalizeExternalHttpUrl(
  import.meta.env.VITE_MAIN_SYSTEM_URL,
  'https://iptt.top'
)

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const status = ref('loading')
const errorMessage = ref('')

function resolveSsoErrorMessage(error) {
  const responseStatus = Number(error.response?.status || 0)
  const responseCode = String(error.response?.data?.code || '')

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return '登录验证超时，本次 state 可能已经过期，请重新发起安全登录。'
  }
  if (!error.response) {
    return '暂时无法连接 ERP 登录服务，请检查网络后重新发起安全登录。'
  }

  const statusMessages = {
    400: 'SSO 回调参数或登录状态无效，请重新发起安全登录。',
    401: '本次登录状态无效、已过期或已使用，请在当前浏览器重新发起安全登录。',
    403: '当前账号没有 ERP 入口权限，请联系管理员在主项目权限中心配置。',
    409: '该登录回调已经处理，不能重复兑换，请重新发起安全登录。',
    410: '本次登录状态或授权码已经过期，请重新发起安全登录。',
    429: '登录请求过于频繁，请稍后从主项目重新进入。',
    500: 'ERP 登录服务暂时异常，请稍后从主项目重新进入。',
    502: 'ERP 暂时无法连接主项目登录服务，请稍后重试。',
    503: 'ERP 登录服务暂时不可用，请稍后从主项目重新进入。',
    504: '主项目登录服务响应超时，请返回主项目重新进入。'
  }

  if (responseCode === 'SSO_CODE_REPLAYED') {
    return '该登录回调已经处理，不能重复兑换，请重新发起安全登录。'
  }
  if (responseCode === 'SSO_CODE_EXPIRED') {
    return '该一次性授权码已经过期，请重新发起安全登录。'
  }
  if (['SSO_STATE_MISSING', 'SSO_STATE_MISMATCH'].includes(responseCode)) {
    return '本次登录 state 与浏览器会话不匹配，请在当前浏览器重新发起安全登录。'
  }
  if (responseCode === 'SSO_STATE_INVALID') {
    return '本次登录 state 无效、已过期或已使用，请重新发起安全登录。'
  }
  if (['SSO_STATE_REPLAYED', 'SSO_STATE_USED'].includes(responseCode)) {
    return '该登录 state 已经使用，不能重复兑换，请重新发起安全登录。'
  }
  if (responseCode === 'SSO_STATE_EXPIRED') {
    return '本次登录 state 已经过期，请重新发起安全登录。'
  }
  if (responseCode === 'INTERNAL_ERROR') {
    return 'ERP 登录服务发生内部错误，请稍后从主项目重新进入。'
  }
  return statusMessages[responseStatus]
    || error.response?.data?.message
    || error.message
    || '授权码无效或已过期，请从主项目重新进入。'
}

function isValidState(state) {
  return typeof state === 'string'
    && /^[A-Za-z0-9_-]{32,200}$/.test(state)
}

async function exchangeCode() {
  // SSO 回调代表一次新的登录尝试。先清理旧 ERP 会话，避免兑换失败时
  // 继续保留上一个账号，也确保兑换请求不会携带旧 Authorization。
  userStore.clearAuth()

  const code = typeof route.query.code === 'string' ? route.query.code.trim() : ''
  const state = typeof route.query.state === 'string' ? route.query.state.trim() : ''
  let requestedRedirect = ''
  const authorizationError = typeof route.query.error === 'string'
    ? route.query.error.trim()
    : ''

  // 读取后立即从地址栏和当前 history 条目移除 Code 与 state，不等待网络兑换结束。
  if (route.fullPath !== '/sso/callback') {
    try {
      await router.replace({ path: '/sso/callback' })
    } catch {
      window.history.replaceState(window.history.state, '', '/sso/callback')
    }
  }

  if (!state) {
    status.value = 'error'
    errorMessage.value = 'SSO 回调缺少 state，已拒绝本次登录请求，请重新发起安全登录。'
    return
  }

  if (!isValidState(state)) {
    status.value = 'error'
    errorMessage.value = 'SSO 回调 state 格式无效，已拒绝本次登录，请重新发起安全登录。'
    return
  }

  if (authorizationError) {
    status.value = 'error'
    errorMessage.value = authorizationError === 'access_denied'
      ? '主项目未授予本次 ERP 登录，请确认账号权限后重新进入。'
      : '主项目未能完成 ERP 授权，请返回主项目重新进入。'
    return
  }

  if (!code) {
    status.value = 'error'
    errorMessage.value = 'SSO 回调缺少一次性授权码，请重新发起安全登录。'
    return
  }

  try {
    const session = await userStore.exchangeSsoCode(code, state)
    requestedRedirect = session?.redirect || session?.postAuthRedirect || ''
    await router.replace(resolvePostAuthRedirect(userStore, requestedRedirect))
  } catch (error) {
    userStore.clearAuth()
    status.value = 'error'
    errorMessage.value = resolveSsoErrorMessage(error)
  }
}

function openMainSystem() {
  assignExternalHttpUrl(mainSystemUrl)
}

function retrySso() {
  router.replace('/sso/initiate')
}

function openLoginPage() {
  router.replace('/login')
}

onMounted(exchangeCode)
</script>

<style scoped lang="scss">
.sso-callback {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.callback-card {
  width: min(440px, 100%);
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

.error-icon {
  color: #e6a23c;
}

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
