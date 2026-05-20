# IP 系统 — 专利代查接口需求

## 一、背景

ERP 系统管理公司收购囤积的专利（约 261 条），需要查询这些专利的年费状态、法律状态、变更记录等信息。但这些专利不属于 IP 系统的客户专利库，不应录入 IP 系统的 patents 表。

需要 IP 系统提供一个"代查"能力：接收专利号，利用已有的国知局查询能力返回结果，但不污染 IP 系统的业务数据。

## 二、接口设计

### 2.1 单个专利代查

```http
POST /api/v1/patent-query/detail
Content-Type: application/json
Authorization: Bearer <token>

{
  "patentNo": "2023203927131"
}
```

**响应**（与现有 `patent-fee/detail` 格式一致）：

```json
{
  "code": 200,
  "data": {
    "patent": {
      "patentNo": "2023203927131",
      "patentName": "一种xxx装置",
      "patentType": "实用新型",
      "appPerson": "xxx公司",
      "appDate": "2023-04-15",
      "feeStatus": "normal",
      "nextFeeDeadline": "2026-08-20",
      "feeAmount": 600,
      "feeYear": 3,
      "feeSurcharge": 0,
      "patentStatusText": "专利权维持",
      "legalStatus": "专利权有效"
    },
    "detail": {
      "inventor": "张三",
      "agency": "xxx代理事务所",
      "agent": "李四",
      "ipcCode": "B25J9/16",
      "grantDate": "2023-10-20",
      "grantNumber": "CN219xxx",
      "legalStatus": "专利权有效",
      "businessStatus": "专利权维持"
    },
    "feesDue": [
      { "feeName": "实用新型第3年年费", "amount": "600", "deadline": "2026-08-20", "feeStatus": "应缴" }
    ],
    "feesPaid": [
      { "feeName": "实用新型第2年年费", "amount": "600", "paidDate": "2025-06-10", "payer": "xxx" }
    ],
    "dispatches": [],
    "pledges": [],
    "licenses": [],
    "changes": []
  }
}
```

**错误响应**：

```json
// 国知局查不到该专利
{ "code": 404, "message": "国知局未查询到该专利号" }

// 查询失败（国知局不可用等）
{ "code": 503, "message": "国知局查询服务暂时不可用，请稍后重试" }
```

### 2.2 批量代查（可选，优先级低）

```http
POST /api/v1/patent-query/batch
Content-Type: application/json
Authorization: Bearer <token>

{
  "patentNos": ["2023203927131", "2022249251X", "2022228347672"],
  "skipExisting": true
}
```

**说明**：
- `skipExisting`: 如果该专利号已在 IP 系统 patents 表中存在，是否跳过（避免重复查询）
- 批量接口为异步，返回任务 ID，通过轮询获取结果
- 每次最多 50 个专利号

**响应**：
```json
{
  "code": 200,
  "data": {
    "taskId": "query_20260520_001",
    "total": 3,
    "message": "查询任务已提交，请通过 /patent-query/task/:taskId 获取结果"
  }
}
```

### 2.3 查询任务结果（配合批量接口）

```http
GET /api/v1/patent-query/task/:taskId
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "taskId": "query_20260520_001",
    "status": "completed",
    "total": 3,
    "success": 2,
    "failed": 1,
    "results": [
      { "patentNo": "2023203927131", "status": "success", "data": { ... } },
      { "patentNo": "2022249251X", "status": "success", "data": { ... } },
      { "patentNo": "2022228347672", "status": "failed", "error": "国知局未查询到" }
    ]
  }
}
```

## 三、技术要求

### 3.1 数据隔离

- **不写入 patents 表**：代查结果不进入 IP 系统的专利管理流程
- **独立缓存表**：建议新建 `patent_query_cache` 表存储代查结果
  - 字段：patent_no, query_result(JSON), queried_at, expires_at
  - 缓存有效期：7 天（可配置）
  - 缓存命中时直接返回，不重复查国知局

### 3.2 查询逻辑

```
请求进来 → 查缓存表
  ├─ 缓存命中且未过期 → 直接返回
  └─ 缓存未命中或已过期 → 调用国知局查询模块
       ├─ 查询成功 → 写入/更新缓存 → 返回结果
       └─ 查询失败 → 返回错误（不写缓存）
```

### 3.3 频率控制

- 单个接口：正常限流即可（复用现有 rate-limit）
- 批量接口：后台队列执行，每个专利间隔 3 秒（与现有定时任务一致）
- 建议对 ERP 调用方做独立的频率统计（按 user/tag 区分）

### 3.4 权限

- 需要有效的 JWT Token
- 建议限制为 `tags` 包含 `erp` 或 `finance` 的用户才能调用
- 或者新增一个 `role: service` 的系统账号专供 ERP 使用

### 3.5 复用现有能力

代查接口应该复用 IP 系统已有的：
- 国知局 cpquery 登录态管理
- 年费查询解析逻辑
- 详情查询解析逻辑（发明人/代理/IPC 等）
- 发文/质押/许可/变更的解析逻辑

本质上就是把现有的"查询并入库"流程改为"查询并返回（可选缓存）"。

## 四、缓存表设计建议

```sql
CREATE TABLE IF NOT EXISTS `patent_query_cache` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `patent_no` VARCHAR(50) NOT NULL COMMENT '专利号',
  `query_result` JSON NOT NULL COMMENT '查询结果（完整 JSON）',
  `query_source` VARCHAR(20) DEFAULT 'cpquery' COMMENT '数据来源',
  `queried_at` DATETIME NOT NULL COMMENT '查询时间',
  `expires_at` DATETIME NOT NULL COMMENT '过期时间',
  `requested_by` INT DEFAULT NULL COMMENT '请求方用户 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_patent_no` (`patent_no`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专利代查缓存';
```

## 五、ERP 侧调用场景

| 场景 | 调用方式 | 频率 |
|------|---------|------|
| 单个专利详情页点"更新年费" | 单个代查 | 用户手动触发 |
| 批量入库时补全专利信息 | 逐个代查（间隔 3 秒） | 入库时 |
| 每周日批量扫描全量信息 | 批量代查（如有）或逐个代查 | 每周一次 |
| 异常检测（质押/变更等） | 复用代查结果中的 changes/pledges | 同上 |

## 六、优先级

1. **P0（必须）**：单个代查接口 `POST /patent-query/detail` — ERP 所有功能依赖此接口
2. **P1（建议）**：缓存机制 — 避免重复查国知局，减少被封风险
3. **P2（可选）**：批量代查 + 任务轮询 — 提升批量扫描效率

## 七、与现有接口的区别

| | 现有 `patent-fee/detail/:no` | 新增 `patent-query/detail` |
|---|---|---|
| 数据来源 | IP 系统 patents 表（已录入的） | 实时查国知局（或缓存） |
| 前提条件 | 专利必须已在 IP 系统中录入 | 任意专利号都能查 |
| 是否写入 patents 表 | 否（只读） | **否**（完全隔离） |
| 返回格式 | 相同 | 相同 |
| 适用场景 | 查客户专利 | 查 ERP 囤积专利 |

---

**文档版本**：v1.0  
**创建日期**：2026-05-20  
**用途**：提供给 IP 系统侧开发参考
