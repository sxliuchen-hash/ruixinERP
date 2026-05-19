#!/bin/bash
# ============================================================
# ERP 一键部署脚本（在服务器上执行）
# ============================================================
# 用法：bash /var/www/erp/backend/scripts/deploy.sh
# ============================================================

set -e

REPO_DIR=/var/www/erp
FRONTEND_NGINX_DIR=/www/wwwroot/erp.iptt.top

echo "[1/5] 拉取最新代码..."
cd "$REPO_DIR" && git pull

echo "[2/5] 安装后端依赖（如有）..."
cd "$REPO_DIR/backend" && npm install --production --no-audit --no-fund

echo "[3/5] 构建前端..."
cd "$REPO_DIR/frontend" && npm install --no-audit --no-fund && npm run build

echo "[4/5] 部署前端到 Nginx 目录..."
rm -rf "$FRONTEND_NGINX_DIR"/*
cp -r "$REPO_DIR/frontend/dist/"* "$FRONTEND_NGINX_DIR/"

echo "[5/5] 重启后端服务..."
pm2 restart erp-backend

echo ""
echo "✓ 部署完成"
echo "  - 前端：$FRONTEND_NGINX_DIR"
echo "  - 后端 PM2：erp-backend"
echo ""
echo "请在浏览器中按 Ctrl+Shift+R 强制刷新页面查看效果。"
