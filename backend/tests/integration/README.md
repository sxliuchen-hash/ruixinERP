# 集成测试说明

这些测试覆盖**依赖数据库**的关键逻辑（金额联动、数据隔离等），与纯函数单测分开。

## 默认行为
- 未设置 `RUN_DB_TESTS=1` 时，集成用例通过 `describe.skip` **自动跳过**，因此 CI / 普通 `npm test` 不受影响、不需要数据库。

## 如何运行
1. 准备一个**测试库**（独立于生产），建表：`mysql ... < backend/scripts/init-database.sql`。
2. 配置环境变量（指向测试库；务必不要指向生产库）：
   ```bash
   set DB_NAME=erp_test
   set DB_USER=root
   set DB_PASSWORD=...
   set MAIN_DB_NAME=patent_notice_system_test
   set RUN_DB_TESTS=1
   ```
3. 运行：`npx jest tests/integration`

## 覆盖目标（对应《关键流程回归清单》）
- 收付款 ↔ 合同 `paid_amount` 联动（手动 / `applyConfirmedSideEffects`）
- `getDetail` 数据隔离（agent 越权读被拦）
- 转账事务 + 行锁（余额不足拒绝 / 不超额）
- 业绩重复上传拦截

## 注意
- 用例使用「未提交事务 + 末尾 `rollback`」做清理，避免污染测试库；仍建议用独立测试库。
- `example.integration.test.js` 为脚手架示例，接入测试库后请按实际 seed 数据补全断言。
