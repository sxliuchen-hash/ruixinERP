# 设计方案：URL Token 彻底治理

> 背景：旧版本曾在文件下载和跨系统登录 URL 中传递 JWT。
> 状态：双方代码已完成 R7 治理；文件使用一次性 Ticket，SSO 使用 ERP 发起并绑定浏览器的 state + 主项目一次性 Code，代码不再接受 `?token=`。当前只待受控环境配置和真实联调。

---

## 一、现状与风险

| 场景 | 现状 | 风险 |
|------|------|------|
| 文件预览/下载 | 已切换为 60 秒一次性 Ticket | 长效 JWT 不进入 URL |
| SSO 登录跳转 | ERP `/sso/initiate` 生成 state，主项目 authorize 后回调 `/sso/callback?code=...&state=...` | 等待环境地址、凭证、公钥和测试账号完成真实联调 |

JWT 有效期 7 天，一旦泄漏窗口较大。

---

## 二、目标
1. URL 中不再出现长效 JWT。
2. 即使 URL 被记录，凭证也**短时、一次性、最小权限**。
3. 向后兼容，灰度可回滚。

---

## 三、方案

### 方案 A（推荐）：文件下载「一次性票据 Ticket」
- 新增 `POST /api/v1/files/ticket`（需正常 JWT 鉴权，Body: `{ key, resourceType, resourceId }`）：
  - 服务端同时校验 `erp.file.download`、资源查看权限及 `self/team/all`；当前合同附件会验证合同 scope 和 key 确实属于该合同；
  - 生成随机 `ticket`（当前为 24 字节随机值的 hex），在 Redis 保存 key、用户、权限版本、资源和 scope 快照，TTL 60s，一次性；
  - 返回 `{ ticket }`。
- 改造 `GET /api/v1/files/download?ticket=<ticket>`：
  - 通过 Redis Lua 在一次原子操作中 `GET + DEL`，校验通过后返回文件流；
  - 票据 60s 过期 + 用后即焚 → URL 即使被记录也很快失效。
- `?token=` 兼容已经下线，Redis 不可用时返回错误，不回退长效 Token。

前端改造（`ContractDetail.vue` 等）：
```
预览/下载前：const { ticket } = await api.post('/files/ticket', { key, resourceType: 'contract', resourceId })
然后 window.open(`/api/v1/files/download?ticket=${ticket}`)
```

### 方案 B（推荐）：R7 state + code 换 ERP 会话
- 主项目入口先跳 ERP 固定 `/sso/initiate`；ERP 生成随机 state、Redis 只保存哈希，并用 Secure/HttpOnly/SameSite=Lax Cookie 绑定发起浏览器。
- ERP 跳转主项目 `/sso/continue?app=erp&state=...`；主项目 authorize 生成 60 秒一次性 Code，固定绑定 userId/audience/redirectUri/state。
- 主项目跳转 `erp.iptt.top/sso/callback?code=<code>&state=<state>`；ERP 回调页在网络请求前清除 URL/history，再调用 `POST /api/v1/auth/sso/exchange { code, state }`。
- ERP 后端原子消费 state，随后携带 `authorizationCode/state/audience/redirectUri` 调用主项目内部兑换接口，验证 RS256 assertion 后签发 ERP 独立会话。
- code/state 均一次性；缺 Cookie、跨浏览器、重复或并发消费、Redis 故障均 fail-closed。

### 方案 C（备选）：下载走 httpOnly Cookie
- 登录时下发 httpOnly + Secure + SameSite Cookie，下载接口同时接受 Cookie 鉴权。
- 优点：`<img>`/`window.open` 自动带 Cookie，无需 URL token。
- 代价：与现有 Bearer 体系并存、需处理 CSRF（下载为 GET 只读，风险低）。当前前后端可能跨子域，需设 `Domain=.iptt.top`。

---

## 四、推荐组合
- **文件**：方案 A（一次性票据），改造量小、收益直接、不依赖主项目。
- **SSO**：方案 B（code 换 ERP 会话），需主项目完成 Code 签发；ERP 不保留 `?token=` 兼容。

---

## 五、实施步骤（建议顺序）
1. 已完成：后端 `files/ticket` + Redis 一次性票据。
2. 已完成：前端预览/下载先取票据再打开。
3. 已完成：下线文件下载和前端路由的 `?token=` 分支。
4. 已完成：ERP `/api/v1/auth/sso/initiate`、`/api/v1/auth/sso/exchange`、浏览器 state 绑定和 RS256 assertion 验签。
5. 已完成：主项目 R7 authorize/exchange、一次性 Code、权限目录、团队范围和权限版本接口；待受控环境配置后联调。

## 六、工作量与风险
- 文件票据：已完成并下线旧兼容。
- SSO code/state：代码已完成，剩余工作是环境配置、七类账号和跨系统验收。
- Redis 依赖：票据存 Redis；Redis 不可用时文件票据签发失败，不降级为长效 Token。

## 七、验收
- 抓取文件预览/下载的网络请求：URL 不含 JWT，仅含 60s 一次性 ticket；重复使用同一 ticket 失败。
- SSO 跳转 URL 不含 JWT；跨浏览器 state、state/code 重放和并发重复消费均失败。
