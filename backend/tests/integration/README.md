# 集成测试说明

这些测试覆盖**依赖真实 MySQL/InnoDB**的关键逻辑（显式迁移只读幂等、金额联动、数据隔离、事务锁和唯一约束），与纯函数单测分开。

## 默认行为
- 未设置 `RUN_DB_TESTS=1` 时，集成用例通过 `describe.skip` **自动跳过**，因此 CI / 普通 `npm test` 不受影响、不需要数据库。

## 如何运行
以下命令从 `backend` 目录执行。

1. 复制 `.env.test.example` 为 `.env.test`，填写独立测试数据库连接；数据库名必须包含独立的 `test`、`ci` 或 `sandbox` 标识。
2. 初始化测试库。脚本会把固定的 `erp_db` 初始化目标安全替换为已验证的 `DB_NAME`，并拒绝正式库名：
   ```bash
   set NODE_ENV=test
   set ALLOW_TEST_DB_INIT=YES
   npm run init:test-db
   ```
3. 初始化完成后关闭初始化授权并执行集成测试：
   ```bash
   set ALLOW_TEST_DB_INIT=NO
   set RUN_DB_TESTS=1
   npx jest tests/integration --runInBand --detectOpenHandles
   ```

## 覆盖目标（对应《关键流程回归清单》）
- 收付款 ↔ 合同 `paid_amount` 联动：在未提交事务内执行 `applyConfirmedSideEffects`，断言金额后回滚。
- 系统设置结构：确认新库 `system_settings` 与正式迁移契约一致，默认 `channel_sales_cost` 可由模型读取，重复执行迁移为只读 no-op。
- `getDetail` 数据隔离：创建带 `created_by` 的报销单，断言其他 agent 的 self scope 返回 `NOT_FOUND`，本人可读。
- 转账事务 + 行锁：余额不足不落库；两个并发 80 元出账争用同一 100 元账户时仅一个成功，最终余额不为负。
- 业绩重复上传/批次唯一性：顺序和并发确认同年月时最多一个 `confirmed`；数据库生成列唯一索引拒绝第二个 confirmed，同时允许多个 draft。

## 注意
- 能在外部事务运行的用例使用「未提交事务 + 末尾 `rollback`」清理；服务内部自建事务的用例使用唯一测试标识并在 `finally` 可靠删除。仍必须使用独立测试库。
- `RUN_DB_TESTS` 只有精确等于 `1` 才会启用，并强制要求 `NODE_ENV=test` 与安全测试库名。
- 禁止直接把 `backend/scripts/init-database.sql` 导入生产或开发库来运行集成测试；原始 SQL 固定目标为 `erp_db`，必须通过 `npm run init:test-db` 参数化。
- `example.integration.test.js` 已覆盖上述真实业务流程，不依赖主项目或固定 seed 数据。
- 存量库上线前必须先执行 `npm run migrate:performance-confirmed-period-unique`。迁移发现历史 confirmed 年月重复时会 fail-closed，保留原数据供人工核对。
