# T21 主项目侧集成指南

> 状态：已更新到 R7 RP 发起流程。本文只保留当前有效集成入口，旧版 URL JWT、无 state callback 和共享 `JWT_SECRET` 方案已经删除。

## 主项目入口

主项目应按 `erp.app.view` 控制“ERP 财务”按钮是否可见，不再硬编码 `admin/process/agent`。

按钮点击后必须先打开 ERP 固定发起地址：

```text
https://erp.iptt.top/sso/initiate
```

ERP 生成并绑定当前浏览器的 `state` 后跳转主项目 `/sso/continue?app=erp&state=...`。主项目 authorize 成功后只能回到固定地址：

```text
https://erp.iptt.top/sso/callback?code=<one-time-code>&state=<same-state>
```

主项目不得把登录 JWT 放入 ERP URL，也不得绕过 `/sso/initiate` 直接生成无 state 的 callback。

## ERP 已提供的能力

- `POST /api/v1/auth/sso/initiate`：生成 RP state、写入 Redis 哈希并绑定 HttpOnly 浏览器 Cookie。
- `POST /api/v1/auth/sso/exchange`：浏览器把一次性 Code 和同一 state 交给 ERP 后端。
- `GET /api/v1/internal/permissions/manifest`：主项目权限中心同步 ERP 权限目录。
- RS256 assertion 验签和 active/previous `kid` 轮换。
- ERP 独立短会话、`permissionVersion` 失效、`self/team/all` 数据范围。
- ERP 顶栏返回主项目时只打开主项目地址，不携带 Token。

`SystemSwitch` 不承担进入 ERP 的 SSO；它只负责从 ERP 返回或打开主项目。进入 ERP 必须由主项目应用入口先打开 ERP `/sso/initiate`，再按 R7 state 链路完成授权。

## 正式接口契约

以以下文档为准：

```text
docs/2026-07-10-主项目统一ERP权限与SSO改造交接文档.md
docs/2026-07-10-ERP统一权限与SSO改造实施确认清单.md
backend/src/permissions/erp-permission-manifest.json
```
