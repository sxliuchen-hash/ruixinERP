# ERP R8 HttpOnly Cookie 会话迁移方案

更新时间：2026-07-11

## 1. 决策

R7 继续使用现有 Bearer 会话完成主项目真实联调、旧登录下线和生产切换。

不把当前 ERP JWT 直接写入 Cookie。本地测量中，全权限 JWT 约 5077 bytes，加上 Cookie 属性后约 5136 bytes，超过常见单 Cookie 4096-byte 限制。Cookie 自动发送还会引入 CSRF，而当前约 106 个写路由尚无统一 CSRF 门禁。

R8 目标方案：

> 浏览器只保存短小、不可解释的 opaque session ID；用户、权限快照、authSource、permissionVersion 和会话状态存入 Redis。

## 2. 目标安全模型

- Cookie 名称：`__Host-erp_session`
- `HttpOnly=true`
- `Secure=true`
- `SameSite=Lax`
- `Path=/`
- 不设置 `Domain`
- 每次登录、SSO exchange 和权限身份切换都旋转 session ID
- Redis 故障、会话缺失、会话过期或 permissionVersion 失效时 fail-closed
- 所有 Cookie 认证的 POST/PUT/PATCH/DELETE 请求执行 Origin 与 CSRF 双重校验
- `/internal` 服务凭证接口不使用浏览器 Cookie，也不套用浏览器 CSRF
- 文件下载继续使用 60 秒一次性 Ticket，不恢复 URL 长效 Token

## 3. 推荐迁移阶段

### 阶段一：bearer

- 保持 R7 现状。
- 新增 Redis session、Cookie 和 CSRF 基础设施，但不改变浏览器认证载体。

### 阶段二：dual

- 后端同时支持 Cookie 和旧 Bearer。
- 新前端使用 Cookie + CSRF，旧前端继续使用 Bearer。
- 只有实际使用 Cookie 认证的写请求才强制 CSRF。
- Cookie 与 Bearer 对应不同用户时拒绝请求，不允许静默选择其中一个。
- Cookie 存在但无效时不得降级尝试 Bearer。

### 阶段三：cookie_preferred

- 新前端删除 `erp_token`。
- 页面启动时通过 `/auth/session` 或 `/auth/profile` 异步恢复登录状态。
- 后端继续接受存量 Bearer，时间至少覆盖旧 JWT 最大有效期。

### 阶段四：cookie_only

- 浏览器登录和 SSO 响应不再返回 Token。
- 停止接受浏览器 Bearer。
- 主项目内部接口和 IP 系统继续使用独立 Client Credential/Header，不受影响。

建议开关：

```text
ERP_SESSION_TRANSPORT=bearer|dual|cookie
ERP_SESSION_COOKIE_NAME=__Host-erp_session
ERP_SESSION_COOKIE_SECURE=true
ERP_SESSION_COOKIE_SAME_SITE=Lax
ERP_SESSION_TTL_SEC=<待确认>
ERP_CSRF_ENABLED=true
```

## 4. 后端改造范围

必须修改：

- `controllers/authController.js`
  - 登录成功创建 Redis session 并设置 Cookie。
  - logout 在有效、过期和损坏 Cookie 下都幂等清理。
- `controllers/ssoController.js`
  - initiate 和 exchange 前清除旧 ERP 会话。
  - exchange 成功旋转 session；失败不得保留旧账号会话。
- `services/mainSsoService.js`
  - 不再生成携带完整权限 grants 的浏览器 JWT。
- `middlewares/auth.js`
  - 支持 bearer/dual/cookie 三种模式。
  - 明确双凭证冲突和无效 Cookie 行为。
- `routes/auth.js`
  - 增加 session/CSRF 获取接口。
  - logout 不因失效 Cookie 被前置 authenticate 阻断。
- `app.js`
  - 增加统一 Origin/CSRF 门禁，并保持精确 CORS allowlist 与 `credentials:true`。
- `errorHandler.js`
  - 会话失效时可统一清理 session Cookie。
- `unifiedAuthPreflightService.js`
  - 校验 transport、Cookie、TTL、Redis 和 CSRF 配置。

建议新增：

- `config/sessionCookie.js`
- `services/sessionService.js`
- `middlewares/csrf.js`

## 5. 前端改造范围

- `api/request.js`
  - Cookie 模式移除 Authorization 注入。
  - 所有请求使用 credentials；写请求携带 `X-CSRF-Token`。
- `stores/user.js`
  - 删除 `erp_token` 持久化。
  - 登录状态改为 `unknown/loading/authenticated/anonymous`。
  - 多标签同步改为 BroadcastChannel 或不含凭证的 logout epoch。
- `router/index.js`
  - 守卫等待首次 session hydration，避免刷新时闪跳登录页。
- `SsoInitiate.vue`、`SsoCallback.vue`
  - 账号切换和失败清理改由后端 Cookie 生命周期保证。
  - exchange 响应不再要求 Token。
- `Login.vue`、`api/auth.js`
  - 支持无 Token 的登录响应。
- 导入、导出、模板下载和附件上传
  - 移除 Bearer，使用 Cookie credentials 与 CSRF。

## 6. 必须通过的验收

后端：

- Cookie 属性正确且长度低于浏览器限制。
- login/exchange 设置并旋转 session。
- initiate、exchange 失败和账号切换均清除旧 Cookie。
- bearer/dual/cookie 三种模式及回滚路径完整。
- 双凭证身份冲突拒绝；无效 Cookie 不降级。
- Redis 过期、删除、故障和 permissionVersion 变化均立即失效。
- 写请求缺少/错误 CSRF 或错误 Origin 时拒绝。
- GET/HEAD/OPTIONS 和 `/internal` 不被误拦截。
- CORS 不允许 `* + credentials`。

前端：

- 刷新等待 session hydration，不出现登录循环。
- login/SSO 响应无 Token 仍能进入首个有权页面。
- localStorage 不再出现 ERP Token。
- 401、退出、账号切换和多标签同步正确。
- 导入、导出、附件和文件 Ticket 流程正常。
- 静态门禁禁止恢复浏览器 Bearer 和 `erp_token`。

## 7. 实施前置条件

- R7 真实 Code/state、team scope、permissionVersion 和 provisioning 联调通过。
- 旧密码登录和 legacy session 完成既定下线。
- Redis 容量、延迟、持久化和故障演练方案已确认。
- R8 单独建立发布、灰度和回滚窗口，不与 R7 首次生产切换合并。
