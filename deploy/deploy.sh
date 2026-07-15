#!/usr/bin/env bash

set -u

RUNBOOK_PATH='docs/部署运维手册.md'

printf '%s\n' \
  'ERROR: 历史一键部署入口已禁用（fail-closed）。' \
  '未执行任何拉取、迁移、构建、重启或流量切换操作。' \
  "请从仓库根目录打开 ${RUNBOOK_PATH}，按其中的手工维护发布流程执行。" >&2

exit 78
