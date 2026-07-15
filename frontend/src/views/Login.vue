<template>
  <div class="login-container">
    <div class="login-card">
      <h2 class="login-title">ERP 财务管理系统</h2>
      <p class="login-subtitle">内部管理平台</p>
      <el-alert
        v-if="loginReasonMessage"
        :title="loginReasonMessage"
        type="warning"
        :closable="false"
        show-icon
        class="login-alert"
      />
      <el-alert
        v-if="!featuresLoaded"
        title="正在读取 ERP 登录配置"
        type="info"
        :closable="false"
        show-icon
        class="login-alert"
      />
      <el-alert
        v-else-if="featuresLoadFailed"
        title="无法读取 ERP 登录配置，已安全关闭密码登录入口"
        type="error"
        :closable="false"
        show-icon
        class="login-alert"
      />
      <el-alert
        v-else-if="!passwordLoginEnabled"
        title="ERP 密码登录已关闭，请从主项目进入"
        type="info"
        :closable="false"
        show-icon
        class="login-alert"
      />
      <el-form
        v-if="featuresLoaded && passwordLoginEnabled"
        ref="loginFormRef"
        :model="loginForm"
        :rules="loginRules"
        label-width="0"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="loginForm.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
            size="large"
            clearable
            autocomplete="username"
            name="username"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="loginForm.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            size="large"
            show-password
            autocomplete="current-password"
            name="password"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            :disabled="loading"
            class="login-btn"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>
      <el-button
        v-if="showMainSystemButton"
        type="primary"
        plain
        size="large"
        class="main-system-btn"
        @click="handleMainSystemAction"
      >
        {{ ssoLoginEnabled ? '从主项目安全登录' : '返回主项目' }}
      </el-button>
      <el-button
        v-if="featuresLoadFailed"
        size="large"
        class="main-system-btn"
        @click="loadAuthFeatures"
      >
        重试读取登录配置
      </el-button>
      <div class="login-footer">
        <span>仅限内部人员使用</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { getAuthFeatures } from '@/api/auth'
import { normalizeLocalRedirect, resolvePostAuthRedirect } from '@/utils/authNavigation'
import { assignExternalHttpUrl, normalizeExternalHttpUrl } from '@/utils/externalNavigation'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loginFormRef = ref(null)
const loading = ref(false)
const featuresLoaded = ref(false)
const featuresLoadFailed = ref(false)
const passwordLoginEnabled = ref(false)
const ssoLoginEnabled = ref(false)
const fallbackMainSystemUrl = normalizeExternalHttpUrl(
  import.meta.env.VITE_MAIN_SYSTEM_URL,
  'https://iptt.top'
)
const mainSystemUrl = ref(fallbackMainSystemUrl)
const showMainSystemButton = computed(() => (
  featuresLoaded.value &&
  Boolean(mainSystemUrl.value) &&
  (ssoLoginEnabled.value || !passwordLoginEnabled.value || featuresLoadFailed.value)
))
const loginReasonMessage = computed(() => {
  const messages = {
    session_expired: passwordLoginEnabled.value
      ? 'ERP 登录已过期，请重新从主项目进入，或使用备用登录。'
      : 'ERP 登录已过期，请重新从主项目进入。',
    no_erp_access: '当前账号没有 ERP 入口权限，请联系管理员在主项目权限中心配置。',
    session_check_failed: '暂时无法验证 ERP 会话，已安全退出，请从主项目重新进入。',
    logged_out: '已安全退出 ERP。需要继续使用时，请从主项目重新进入。'
  }
  return messages[route.query.reason] || ''
})

const loginForm = reactive({
  username: '',
  password: ''
})

const loginRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' }
  ]
}

async function loadAuthFeatures() {
  featuresLoaded.value = false
  featuresLoadFailed.value = false
  try {
    const response = await getAuthFeatures()
    const features = response.data || {}
    // 服务端必须明确返回 true 才展示密码入口；响应字段缺失或异常时保持 fail-closed。
    passwordLoginEnabled.value = features.passwordLoginEnabled === true
    ssoLoginEnabled.value = features.ssoLoginEnabled === true
    mainSystemUrl.value = normalizeExternalHttpUrl(
      features.mainSystemUrl,
      fallbackMainSystemUrl
    )
  } catch {
    // 登录方式属于安全配置。读取失败时不能猜测密码登录可用，保持默认拒绝。
    featuresLoadFailed.value = true
    passwordLoginEnabled.value = false
    ssoLoginEnabled.value = false
    mainSystemUrl.value = fallbackMainSystemUrl
  } finally {
    featuresLoaded.value = true
  }
}

onMounted(loadAuthFeatures)

function handleMainSystemAction() {
  if (ssoLoginEnabled.value) {
    const redirect = normalizeLocalRedirect(route.query.redirect)
    router.push({
      path: '/sso/initiate',
      query: redirect ? { redirect } : undefined
    })
    return
  }
  assignExternalHttpUrl(mainSystemUrl.value)
}

async function handleLogin() {
  if (!featuresLoaded.value || !passwordLoginEnabled.value) return
  if (loading.value) return
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await userStore.login(loginForm)
    ElMessage.success('登录成功')
    await router.replace(resolvePostAuthRedirect(userStore, route.query.redirect))
  } catch (error) {
    // 从响应中提取错误信息
    const message = error.response?.data?.message || error.message || '登录失败，请重试'
    ElMessage.error(message)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
  box-sizing: border-box;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  width: min(400px, 100%);
  padding: 40px;
  box-sizing: border-box;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.login-title {
  text-align: center;
  margin-bottom: 8px;
  color: #303133;
  font-size: 24px;
  font-weight: 600;
}

.login-subtitle {
  text-align: center;
  margin-bottom: 30px;
  color: #909399;
  font-size: 14px;
}

.login-alert {
  margin-bottom: 20px;
}

.login-btn {
  width: 100%;
  margin-top: 10px;
}

.main-system-btn {
  width: 100%;
  margin-top: 4px;
}

.login-footer {
  text-align: center;
  margin-top: 20px;
  color: #c0c4cc;
  font-size: 12px;
}
</style>
