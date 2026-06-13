# 设计方案：URL Token 彻底治理

> 背景：当前两处把 JWT 放在 URL 传递，存在泄漏面（浏览器历史 / Nginx access log / Referer）。
> 本轮已做缓解（登录跳转 `replace` 即时移除、`Referrer-Policy: no-referrer`），本方案为**彻底治理**。
> 状态：设计稿，待排期；涉及主项目 + 前端联调，建议单独立项。

---

## 一、现状与风险

| 场景 | 现状 | 风险 |
|------|------|------|
| 文件预览/下载 | `GET /api/v1/files/download?key=...&token=<JWT>`（`<img>`/`window.open` 无法加 Header，只能塞 URL） | JWT（7 天有效）出现在新窗口 URL、access log |
| SSO 登录跳转 | 主项目跳转 `erp.iptt.top/?token=<JWT>`，前端读取后 `replace` 移除 | 首跳 URL 进入 Nginx access log；Referer 已被 no-referrer 缓解 |

JWT 有效期 7 天，一旦泄漏窗口较大。

---

## 二、目标
1. URL 中不再出现长效 JWT。
2. 即使 URL 被记录，凭证也**短时、一次性、最小权限**。
3. 向后兼容，灰度可回滚。

---

## 三、方案

### 方案 A（推荐）：文件下载「一次性票据 Ticket」
- 新增 `POST /api/v1/files/ticket`（需正常 JWT 鉴权，Body: `{ key }`）：
  - 服务端校验该用户对 `key` 的访问权限；
  - 生成随机 `ticket`（如 32 字节 hex），存 Redis：`erp:file_ticket:{ticket} → { key, userId }`，TTL 60s，一次性；
  - 返回 `{ ticket }`。
- 改造 `GET /api/v1/files/download?ticket=<ticket>`：
  - 从 Redis 取并**立即删除**（用 `GETDEL` 或 `MULTI`），校验通过后返回文件流；
  - 票据 60s 过期 + 用后即焚 → URL 即使被记录也很快失效。
- 兼容：保留 `?token=` 一段时间（灰度），前端切换完成后下线。

前端改造（`ContractDetail.vue` 等）：
```
预览/下载前：const { ticket } = await api.post('/files/ticket', { key })
然后 window.open(`/api/v1/files/download?ticket=${ticket}`)
```

### 方案 B（推荐）：SSO 登录「code 换 token」
- 主项目侧：跳转前调内部接口生成一次性 `auth_code`（短 TTL，绑定 userId），跳转 `erp.iptt.top/sso?code=<code>`。
- ERP 侧：`POST /api/v1/auth/exchange { code }` → 校验 code（与主项目共享存储 / 主项目提供校验接口）→ 换发 ERP JWT（走正常 body，不进 URL）。
- code 一次性、30-60s 过期；URL 里只有短码，不含 JWT。

### 方案 C（备选）：下载走 httpOnly Cookie
- 登录时下发 httpOnly + Secure + SameSite Cookie，下载接口同时接受 Cookie 鉴权。
- 优点：`<img>`/`window.open` 自动带 Cookie，无需 URL token。
- 代价：与现有 Bearer 体系并存、需处理 CSRF（下载为 GET 只读，风险低）。当前前后端可能跨子域，需设 `Domain=.iptt.top`。

---

## 四、推荐组合
- **文件**：方案 A（一次性票据），改造量小、收益直接、不依赖主项目。
- **SSO**：方案 B（code 换 token），需主项目配合；过渡期保留 `?token=` 兼容。

---

## 五、实施步骤（建议顺序）
1. 后端：`files/ticket` 接口 + Redis 票据 + `download` 支持 `ticket`（保留 `token` 兼容）。
2. 前端：预览/下载改为「先取票据再打开」。
3. 验证无 `?token=` 后，下线文件下载的 `token` 兼容分支。
4. SSO：与主项目约定 `auth_code` 生成/校验，ERP 加 `/auth/exchange`，主项目改跳转。
5. 全量切换后移除 SSO `?token=` 分支。

## 六、工作量与风险
- 文件票据：后端 ~0.5 天，前端 ~0.5 天，低风险（有兼容）。
- SSO code：需主项目联调，~1-2 天，依赖跨系统排期。
- Redis 依赖：票据存 Redis；Redis 不可用时可短时降级回 `token`（过渡期）。

## 七、验收
- 抓取文件预览/下载的网络请求：URL 不含 JWT，仅含 60s 一次性 ticket；重复使用同一 ticket 失败。
- SSO 跳转 URL 不含 JWT；code 重放失败。
