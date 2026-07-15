<template>
  <el-result
    icon="warning"
    title="无权访问"
    sub-title="当前账号没有访问该 ERP 功能的权限，请联系管理员在主项目权限中心配置。"
  >
    <template #extra>
      <el-button v-if="authorizedHome !== '/forbidden'" type="primary" @click="goAuthorizedHome">
        进入可访问页面
      </el-button>
      <el-button v-else-if="mainSystemUrl" type="primary" @click="returnToMainSystem">
        返回主项目
      </el-button>
      <el-button v-if="authorizedHome !== '/forbidden'" @click="router.back()">
        返回上一页
      </el-button>
    </template>
  </el-result>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { resolvePostAuthRedirect } from '@/utils/authNavigation'
import { assignExternalHttpUrl, normalizeExternalHttpUrl } from '@/utils/externalNavigation'

const router = useRouter()
const userStore = useUserStore()
const mainSystemUrl = normalizeExternalHttpUrl(
  import.meta.env.VITE_MAIN_SYSTEM_URL,
  'https://iptt.top'
)
const authorizedHome = computed(() => resolvePostAuthRedirect(userStore))

function goAuthorizedHome() {
  router.replace(authorizedHome.value)
}

function returnToMainSystem() {
  assignExternalHttpUrl(mainSystemUrl)
}
</script>
