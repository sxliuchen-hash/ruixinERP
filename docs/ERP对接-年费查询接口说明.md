# ERP 系统对接 — 专利年费查询接口说明

## 一、背景

知识产权官文管理系统（以下简称"IP系统"）已实现专利年费自动查询功能，数据来源为国家知识产权局 cpquery 系统。ERP 系统需要复用这些数据，通过调用 IP 系统的 API 获取专利年费和详情信息。

## 二、系统信息

- **API 基础地址**：`https://iptt.top/api/v1`
- **认证方式**：JWT Token（Bearer Token）
- **共享账号体系**：ERP 和 IP 系统共用 `users` 表，使用相同的登录接口获取 Token
- **用户标签**：`users.tags` 字段（JSON 数组），ERP 相关用户应有 `"finance"` 或 `"erp"` 标签

## 三、认证流程

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "your_username",
  "password": "your_password"
}

响应：
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": 1, "username": "...", "role": "process", "tags": ["finance"] }
  }
}
```

后续所有请求需携带 Header：
```
Authorization: Bearer <token>
```

## 四、可用接口

### 4.1 年费管理列表（分页）

```
GET /api/v1/patent-fee/list?page=1&pageSize=20&feeStatus=normal&keyword=关键词
```

**查询参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| page | number | 页码，默认 1 |
| pageSize | number | 每页条数，默认 20 |
| keyword | string | 搜索（专利号/名称/申请人） |
| feeStatus | string | 年费状态筛选：normal/overdue/recovery/paid/terminated |
| urgencyLevel | string | 紧急度：urgent(30天内)/warning(30-90天)/overdue/terminated |
| sortField | string | 排序字段，默认 fee_deadline |
| sortOrder | string | ASC/DESC |

**响应**：
```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": 1,
        "patentNo": "2020107848060",
        "patentName": "一种芯片及芯片封装方法、电子设备",
        "patentType": "发明专利",
        "appPerson": "深圳市汇顶科技股份有限公司",
        "appDate": "2020-08-06",
        "nextFeeDeadline": "2026-04-22",
        "feeAmount": 1200,
        "feeYear": 6,
        "feeStatus": "normal",
        "feeSurcharge": 0,
        "patentStatusText": "专利权维持",
        "legalStatus": "专利权有效",
        "lastFeeQueryAt": "2026-05-15T07:23:52.000Z"
      }
    ],
    "total": 1384,
    "page": 1,
    "pageSize": 20
  }
}
```

### 4.2 年费仪表盘统计

```
GET /api/v1/patent-fee/dashboard
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "urgent": 0,
    "warning": 0,
    "overdue": 147,
    "normal": 1053,
    "terminated": 184,
    "total": 1384
  }
}
```

### 4.3 单个专利年费详情

```
GET /api/v1/patent-fee/detail/:patentNo
```

**示例**：`GET /api/v1/patent-fee/detail/202010784806X`

**响应**：
```json
{
  "code": 200,
  "data": {
    "patent": {
      "patentNo": "202010784806X",
      "patentName": "一种芯片及芯片封装方法、电子设备",
      "patentType": "发明专利",
      "appPerson": "深圳市汇顶科技股份有限公司",
      "appDate": "2020-08-06",
      "feeStatus": "normal",
      "nextFeeDeadline": "2026-04-22",
      "feeAmount": 1200,
      "feeYear": 6,
      "feeSurcharge": 0,
      "patentStatusText": "专利权维持",
      "legalStatus": "专利权有效",
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

### 4.4 根据专利号获取专利基本信息

```
GET /api/v1/patents/no/:patentNo
```

**响应**：包含 patents 表基本信息 + patent_details 详细信息 + 官文数量。

### 4.5 获取专利的官文列表

```
GET /api/v1/patents/:patentNo/notices?page=1&pageSize=20
```

## 五、年费状态说明

| feeStatus | 含义 | 说明 |
|-----------|------|------|
| normal | 正常 | 有应缴年费，未逾期 |
| overdue | 逾期 | 已过缴费截止日，产生滞纳金 |
| recovery | 恢复期 | 逾期超过6个月，需缴恢复费 |
| paid | 已缴 | 当年年费已缴纳 |
| terminated | 已终止 | 专利权终止（未缴年费失效/驳回/撤回等） |
| null | 未查询 | 尚未查询过年费信息 |

## 六、数据更新频率

| 数据类型 | 更新方式 | 频率 |
|---------|---------|------|
| 年费状态/金额/截止日 | 定时任务（工作日6:00） | 紧急专利每天，普通专利每7-30天 |
| 详细信息（发明人/代理等） | 批量更新详情 | 首次录入后按需 |
| 发文/质押/许可 | 全量刷新时获取 | 按需 |

## 七、权限说明

ERP 系统的用户需要满足以下条件才能访问年费接口：
1. 在 `users` 表中有账号
2. 角色为 admin/process/agent/client/sub_account/sub_department 之一
3. 建议给 ERP 用户设置 `tags: ["finance", "erp"]` 标签

## 八、注意事项

1. **不要直接查询国知局**：所有数据通过 IP 系统 API 获取，IP 系统负责与国知局交互
2. **数据可能有延迟**：年费数据非实时，取决于上次查询时间（`lastFeeQueryAt`）
3. **专利号格式**：13位数字（最后一位可能是X），如 `202010784806X`
4. **频率限制**：API 有频率限制，建议单次请求间隔 > 500ms
5. **Token 有效期**：JWT Token 有效期由系统配置决定（默认24小时），过期后需重新登录
