<!--
  ============================================================
  消息铃铛（NotificationBell）
  ============================================================
  用途：
    - 顶栏右侧的小铃铛图标，未读数以红色 badge 显示
    - 点击打开右侧抽屉，展示消息列表
    - 支持按类型筛选、点击消息跳转 link、批量已读、删除

  轮询策略：
    - 打开时立即拉一次未读数
    - 每 60 秒轮询一次未读数（防止错过实时消息）
    - 打开抽屉时重新拉最新列表
  ============================================================
-->
<template>
  <div class="notification-bell">
    <el-badge
      :value="unreadCount"
      :hidden="!unreadCount"
      :max="99"
      class="bell-badge"
    >
      <el-button link @click="openDrawer">
        <el-icon :size="20"><Bell /></el-icon>
      </el-button>
    </el-badge>

    <el-drawer
      v-model="drawerVisible"
      title="消息中心"
      size="560px"
      destroy-on-close
    >
      <template #header>
        <div class="drawer-header">
          <span>消息中心</span>
          <el-badge
            v-if="unreadCount"
            :value="unreadCount"
            :max="99"
            type="danger"
            class="header-badge"
          />
        </div>
      </template>

      <div class="drawer-toolbar">
        <el-radio-group v-model="filterType" size="small" @change="fetchList">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="contract_expire">合同到期</el-radio-button>
          <el-radio-button value="fee_deadline">年费到期</el-radio-button>
          <el-radio-button value="approval_sync">审批同步</el-radio-button>
          <el-radio-button value="system">系统</el-radio-button>
        </el-radio-group>
        <div class="toolbar-actions">
          <el-checkbox v-model="onlyUnread" @change="fetchList">仅未读</el-checkbox>
          <el-button
            size="small"
            type="primary"
            :disabled="!unreadCount"
            @click="handleMarkAllRead"
          >全部已读</el-button>
        </div>
      </div>

      <div v-loading="loading" class="drawer-list">
        <el-empty v-if="!list.length" description="暂无消息" :image-size="80" />
        <div
          v-for="item in list"
          :key="item.id"
          class="msg-item"
          :class="{ 'msg-item--unread': !item.is_read }"
          @click="handleMsgClick(item)"
        >
          <div class="msg-item__head">
            <el-tag
              :type="LEVEL_MAP[item.level]?.type"
              size="small"
            >{{ LEVEL_MAP[item.level]?.label }}</el-tag>
            <el-tag size="small" type="info">{{ TYPE_MAP[item.type]?.label || item.type }}</el-tag>
            <span class="msg-item__time">{{ formatRelative(item.create_time) }}</span>
            <el-button
              type="danger"
              link
              size="small"
              class="msg-item__del"
              @click.stop="handleDelete(item)"
            >删除</el-button>
          </div>
          <div class="msg-item__title">{{ item.title }}</div>
          <div v-if="item.content" class="msg-item__content">{{ item.content }}</div>
        </div>

        <div v-if="pagination.total > pagination.pageSize" class="drawer-pagination">
          <el-pagination
            v-model:current-page="pagination.page"
            :page-size="pagination.pageSize"
            :total="pagination.total"
            layout="prev, pager, next"
            small
            @current-change="fetchList"
          />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Bell } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getNotificationList,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification
} from '@/api/notification'

const router = useRouter()

// 轮询间隔（毫秒）
const POLL_INTERVAL = 60 * 1000

// 等级 → 标签样式
const LEVEL_MAP = {
  info:    { label: '信息', type: 'info' },
  warning: { label: '警告', type: 'warning' },
  danger:  { label: '紧急', type: 'danger' }
}

// 类型 → 中文
const TYPE_MAP = {
  contract_expire: { label: '合同到期' },
  fee_deadline:    { label: '年费到期' },
  approval_sync:   { label: '审批同步' },
  system:          { label: '系统通知' },
  other:           { label: '其他' }
}

// ===== 状态 =====
const unreadCount = ref(0)
const drawerVisible = ref(false)
const loading = ref(false)
const list = ref([])
const filterType = ref('')
const onlyUnread = ref(false)
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
let pollingTimer = null

// ===== 数据拉取 =====

async function fetchUnreadCount() {
  try {
    const res = await getUnreadCount()
    unreadCount.value = res.data?.count || 0
  } catch (e) {
    // 静默失败（token 过期等会被 request 拦截器处理）
  }
}

async function fetchList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (filterType.value) params.type = filterType.value
    if (onlyUnread.value) params.is_read = 0

    const res = await getNotificationList(params)
    list.value = res.data?.list || []
    pagination.total = res.data?.pagination?.total || 0
  } catch (e) {
    console.error('获取消息失败', e)
  } finally {
    loading.value = false
  }
}

// ===== 交互 =====

function openDrawer() {
  drawerVisible.value = true
  pagination.page = 1
  fetchList()
  fetchUnreadCount()
}

async function handleMsgClick(item) {
  // 先标记已读（若未读）
  if (!item.is_read) {
    try {
      await markNotificationRead(item.id)
      item.is_read = 1
      fetchUnreadCount()
    } catch (e) { /* 静默 */ }
  }
  // 有 link 就跳转并关闭抽屉
  if (item.link) {
    drawerVisible.value = false
    router.push(item.link)
  }
}

async function handleMarkAllRead() {
  try {
    const res = await markAllNotificationsRead()
    ElMessage.success(`已标记 ${res.data?.affected || 0} 条为已读`)
    fetchList()
    fetchUnreadCount()
  } catch (e) { /* 拦截器已提示 */ }
}

async function handleDelete(item) {
  try {
    await deleteNotification(item.id)
    ElMessage.success('已删除')
    fetchList()
    fetchUnreadCount()
  } catch (e) { /* 拦截器已提示 */ }
}

// ===== 相对时间格式化 =====

function formatRelative(time) {
  if (!time) return ''
  const d = new Date(time)
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前'
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前'
  if (sec < 86400 * 7) return Math.floor(sec / 86400) + ' 天前'
  return d.toLocaleDateString('zh-CN')
}

// ===== 生命周期 =====

onMounted(() => {
  fetchUnreadCount()
  // 轮询
  pollingTimer = setInterval(fetchUnreadCount, POLL_INTERVAL)
})

onBeforeUnmount(() => {
  if (pollingTimer) clearInterval(pollingTimer)
})
</script>

<style scoped lang="scss">
.notification-bell {
  display: inline-flex;
  align-items: center;
}

.bell-badge {
  margin-right: 8px;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-badge {
  margin-top: -4px;
}

.drawer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.drawer-list {
  min-height: 200px;
}

.msg-item {
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #f5f7fa;
    border-color: #dcdfe6;
  }

  &--unread {
    background: #f0f8ff;
    border-color: #b3d8ff;

    &:hover { background: #e6f2ff; }
  }
}

.msg-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.msg-item__time {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}

.msg-item__del {
  padding: 0 6px;
}

.msg-item__title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.msg-item__content {
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
  white-space: pre-line;
}

.drawer-pagination {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
</style>
