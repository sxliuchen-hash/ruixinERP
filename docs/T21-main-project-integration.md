# T21 主项目侧集成指南

> 本文档说明如何在主项目（patent-notice-system）中添加 ERP 财务系统入口。

## 需要修改的文件

### 1. 主项目 MainLayout.vue（顶栏增加入口按钮）

在顶栏右侧（用户头像旁边）添加一个"ERP 财务"按钮：

```vue
<!-- 仅 admin/process/agent 角色显示 -->
<el-button
  v-if="['admin', 'process', 'agent'].includes(userRole)"
  text
  type="primary"
  @click="goToErp"
>
  <el-icon><DataAnalysis /></el-icon>
  ERP 财务
</el-button>
```

跳转逻辑：

```javascript
const ERP_URL = 'https://erp.iptt.top'

function goToErp() {
  const token = localStorage.getItem('token') || ''
  const url = `${ERP_URL}?token=${encodeURIComponent(token)}`
  window.open(url, '_blank')
}
```

### 2. 环境变量（可选）

如果希望 ERP URL 可配置：

```env
# .env.production
VITE_ERP_URL=https://erp.iptt.top
```

```javascript
const ERP_URL = import.meta.env.VITE_ERP_URL || 'https://erp.iptt.top'
```

## ERP 侧已完成的工作

1. **SystemSwitch.vue**：ERP 顶栏已有"官文系统"按钮，点击跳转 `https://iptt.top?token=xxx`
2. **路由守卫 Token 接收**：`router/index.js` 的 `beforeEach` 已处理 `?token=xxx` 参数：
   - 从 URL 提取 token → 存入 Pinia store + localStorage
   - 移除 URL 中的 token 参数（避免暴露）
   - 自动调用 `fetchProfile()` 获取用户信息
3. **前端 .env**：`VITE_MAIN_SYSTEM_URL=https://iptt.top`

## SSO 流程

```
主项目 → 点击"ERP 财务" → window.open(erp.iptt.top?token=xxx)
                                    ↓
ERP 路由守卫 → 提取 token → setToken → fetchProfile → 进入系统
                                    ↓
ERP → 点击"官文系统" → window.open(iptt.top?token=xxx)
                                    ↓
主项目路由守卫 → 提取 token → 进入系统
```

## 注意事项

- Token 共享前提：两个系统使用相同的 JWT Secret（已在 ERP backend .env 中配置 `JWT_SECRET`）
- 角色限制：仅 admin/process/agent 可见 ERP 入口（前端控制 + ERP 后端 `requireErpAccess` 中间件双重校验）
- 安全：token 通过 URL 传递后立即从 URL 中移除，避免浏览器历史记录泄露
