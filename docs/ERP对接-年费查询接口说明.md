# ERP 系统对接 — 专利库存查询接口说明

## 一、背景

知识产权官文管理系统（以下简称"IP系统"）已实现专利年费自动查询功能，数据来源为国家知识产权局 cpquery 系统。ERP 系统需要复用这些数据，通过调用 IP 系统的 API 获取专利年费和详情信息。

## 二、系统信息

| 项目 | 说明 |
|------|------|
| 外网地址 | `https://iptt.top/api/v1` |
| 内网地址 | `http://127.0.0.1:3000/api/v1`（同服务器直连，推荐） |
| 认证方式 | JWT Token（Bearer Token） |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

> 同服务器的 ERP 系统建议使用内网地址 `http://127.0.0.1:3000`，无需经过 Nginx，速度更快且不受 CORS 限制。

## 三、认证流程

### 3.1 获取 Token

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "erp_service",
  "password": "your_password"
}
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": 10, "username": "erp_service", "role": "process" }
  }
}
```

### 3.2 使用 Token

后续所有请求需携带 Header：
```
Authorization: Bearer <token>
```

Token 有效期默认 7 天，过期后重新登录即可。

### 3.3 Node.js 调用示例

```javascript
const axios = require('axios');

const API_BASE = 'http://127.0.0.1:3000/api/v1';
let token = '';

// 登录获取token
async function login() {
  const res = await axios.post(`${API_BASE}/auth/login`, {
    username: 'erp_service',
    password: 'your_password'
  });
  token = res.data.data.token;
}

// 带认证的请求
async function apiGet(path, params = {}) {
  const res = await axios.get(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params
  });
  return res.data;
}
```

---

## 四、接口清单

### 4.1 年费管理列表（分页查询）

**用途**：查询专利库存的年费状态，支持筛选和分页。

```http
GET /api/v1/patent-fee/list
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20，最大 100 |
| keyword | string | 否 | 搜索（专利号/名称/申请人） |
| feeStatus | string | 否 | 年费状态：normal/overdue/recovery/paid/terminated |
| urgencyLevel | string | 否 | 紧急度：urgent/warning/overdue/terminated/unqueried/no_detail |
| feeQueryTimeFilter | string | 否 | 年费查询时间：never/1day/7day/30day |
| detailTimeFilter | string | 否 | 详情更新时间：never/7day/30day |
| sortField | string | 否 | 排序字段，默认 next_fee_deadline |
| sortOrder | string | 否 | ASC/DESC |

**响应**：
```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": 1,
        "patentNo": "2020107848060",
        "patentName": "一种芯片及芯片封装方法",
        "patentType": "发明专利",
        "appPerson": "深圳市汇顶科技股份有限公司",
        "appDate": "2020-08-06",
        "nextFeeDeadline": "2026-04-22",
        "feeAmount": 1200,
        "feeYear": 6,
        "feeStatus": "normal",
        "feeSurcharge": 0,
        "feeRecoveryFee": 0,
        "patentStatusText": "专利权维持",
        "legalStatus": "专利权有效",
        "lastFeeQueryAt": "2026-05-15T07:23:52.000Z",
        "lastFullQueryAt": "2026-05-15T07:24:00.000Z",
        "status": "active"
      }
    ],
    "total": 3596,
    "page": 1,
    "pageSize": 20
  }
}
```

---

### 4.2 年费仪表盘统计

**用途**：获取专利年费状态的汇总统计。

```http
GET /api/v1/patent-fee/dashboard
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "urgent": 0,
    "warning": 0,
    "overdue": 232,
    "recovery": 0,
    "normal": 2750,
    "terminated": 614,
    "total": 3596
  }
}
```

---

### 4.3 单个专利年费详情

**用途**：获取某个专利的完整年费信息（含应缴/已缴/发文/质押/许可）。

```http
GET /api/v1/patent-fee/detail/:patentNo
```

**示例**：`GET /api/v1/patent-fee/detail/2020107848060`

**响应**：
```json
{
  "code": 200,
  "data": {
    "patent": {
      "patentNo": "2020107848060",
      "patentName": "一种芯片及芯片封装方法",
      "patentType": "发明专利",
      "appPerson": "深圳市汇顶科技股份有限公司",
      "appDate": "2020-08-06",
      "feeStatus": "normal",
      "nextFeeDeadline": "2026-04-22",
      "feeAmount": 1200,
      "feeYear": 6,
      "feeSurcharge": 0,
      "patentStatusText": "专利权维持",
      "lastFeeQueryAt": "2026-05-15T07:23:52.000Z",
      "lastFullQueryAt": "2026-05-15T07:24:00.000Z"
    },
    "detail": {
      "inventor": "王延宏",
      "agency": "北京阿里巴巴知识产权代理有限公司",
      "agent": "张郁",
      "ipcCode": "H01L23/14",
      "grantDate": "2021-01-29",
      "grantNumber": "CN111739844B",
      "legalStatus": "专利权有效",
      "businessStatus": "专利权维持"
    },
    "feesDue": [
      { "feeName": "发明专利第6年年费", "amount": "1200", "deadline": "2026-04-22", "feeStatus": "应缴" }
    ],
    "feesPaid": [
      { "feeName": "发明专利第5年年费", "amount": "1200", "paidDate": "2025-03-15", "payer": "深圳市汇顶科技股份有限公司" }
    ],
    "dispatches": [
      { "noticeName": "缴费通知书", "dispatchDate": "20260101", "recipient": "...", "dispatchMethod": "电子" }
    ],
    "pledges": [],
    "licenses": [],
    "changes": []
  }
}
```

---

### 4.4 专利基本信息查询（按专利号）

**用途**：根据专利号获取 patents 表中的基本信息。

```http
GET /api/v1/patents/no/:patentNo
```

**示例**：`GET /api/v1/patents/no/2020107848060`

**响应**：
```json
{
  "code": 200,
  "data": {
    "id": 1,
    "patentNo": "2020107848060",
    "patentName": "一种芯片及芯片封装方法",
    "patentType": "发明专利",
    "appPerson": "深圳市汇顶科技股份有限公司",
    "inventor": "王延宏",
    "agent": "北京阿里巴巴知识产权代理有限公司",
    "agentPerson": "张郁",
    "appDate": "2020-08-06",
    "nextFeeDeadline": "2026-04-22",
    "feeAmount": 1200,
    "feeYear": 6,
    "feeStatus": "normal",
    "feeSurcharge": 0,
    "patentStatusText": "专利权维持",
    "status": "active"
  }
}
```

---

### 4.5 专利列表查询（分页）

**用途**：查询专利库存列表，支持按类型、状态、关键词筛选。

```http
GET /api/v1/patents?page=1&pageSize=20&keyword=芯片&patentType=发明专利
```

**查询参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| page | number | 页码 |
| pageSize | number | 每页条数 |
| keyword | string | 搜索（专利号/名称/申请人） |
| patentType | string | 专利类型：发明专利/实用新型/外观设计 |
| status | string | 状态：active/deleted |

---

### 4.6 专利的官文列表

**用途**：获取某个专利关联的所有官文（通知书）。

```http
GET /api/v1/patents/:patentNo/notices?page=1&pageSize=20
```

---

## 五、年费状态字段说明

| feeStatus | 含义 | 说明 |
|-----------|------|------|
| normal | 正常 | 有应缴年费，未逾期 |
| overdue | 逾期 | 已过缴费截止日，产生滞纳金 |
| recovery | 恢复期 | 逾期超过6个月，需缴恢复费 |
| paid | 已缴 | 当年年费已缴纳 |
| terminated | 已终止 | 专利权终止（未缴年费失效/驳回/撤回等） |
| null | 未查询 | 尚未查询过年费信息 |

## 六、紧急度说明

| urgencyLevel | 含义 |
|-------------|------|
| urgent | 30天内到期 |
| warning | 30-90天到期 |
| overdue | 已逾期/恢复期 |
| terminated | 已终止 |
| unqueried | 从未查询过年费 |
| no_detail | 已查年费但未查详情 |

## 七、数据更新频率

| 数据类型 | 更新方式 | 频率 |
|---------|---------|------|
| 年费状态/金额/截止日 | 定时任务（工作日 6:00） | 紧急专利每天 |
| 详细信息（发明人/代理等） | 批量更新详情 | 首次录入后按需 |
| 发文/质押/许可 | 全量刷新时获取 | 按需 |

> `lastFeeQueryAt` 字段表示该专利上次年费查询时间，ERP 可据此判断数据新鲜度。

## 八、ERP 常用场景示例

### 场景1：获取所有即将到期的专利

```http
GET /api/v1/patent-fee/list?urgencyLevel=urgent&pageSize=100
```

### 场景2：获取所有逾期专利（需要催缴）

```http
GET /api/v1/patent-fee/list?feeStatus=overdue&pageSize=100
```

### 场景3：查询某个专利的缴费信息

```http
GET /api/v1/patent-fee/detail/2020107848060
```

### 场景4：获取所有有效专利的库存清单

```http
GET /api/v1/patent-fee/list?feeStatus=normal&pageSize=100&page=1
```

### 场景5：按申请人搜索专利

```http
GET /api/v1/patent-fee/list?keyword=华为&pageSize=50
```

## 九、错误码说明

| code | 含义 |
|------|------|
| 200 | 成功 |
| 400 | 参数错误 |
| 401 | 未认证（Token 无效或过期） |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 429 | 请求频率超限 |
| 500 | 服务器内部错误 |

## 十、注意事项

1. **使用内网地址**：同服务器调用请用 `http://127.0.0.1:3000`，避免走外网
2. **不要直接查询国知局**：所有数据通过 IP 系统 API 获取
3. **数据可能有延迟**：年费数据非实时，参考 `lastFeeQueryAt` 判断新鲜度
4. **专利号格式**：13位（数字+可能末位X），如 `202010784806X`、`2022232371594`
5. **频率限制**：全局 500次/15分钟，建议请求间隔 > 200ms
6. **Token 缓存**：Token 有效期 7 天，ERP 应缓存 Token 避免频繁登录
7. **分页获取全量**：如需获取全部专利，循环分页请求（pageSize=100）

---

**文档版本**：v4.0  
**最后更新**：2026-05-20
