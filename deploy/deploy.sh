#!/bin/bash
# ============================================================
# ERP 财务系统部署脚本
# ============================================================
# 使用方式：
#   chmod +x deploy.sh
#   ./deploy.sh
#
# 前提条件：
#   - 服务器已安装 Node.js 18+, npm, PM2, Nginx
#   - 已配置 erp.iptt.top DNS 解析
#   - 已申请 SSL 证书（certbot）
#   - MySQL 已创建 erp_db 数据库
#   - Redis 已启动
# ============================================================

set -e

echo "===== ERP 财务系统部署开始 ====="

# 项目路径
PROJECT_DIR="/var/www/erp"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# 1. 拉取最新代码
echo "[1/7] 拉取最新代码..."
cd $PROJECT_DIR
git pull origin main

# 2. 后端依赖安装
echo "[2/7] 安装后端依赖..."
cd $BACKEND_DIR
npm ci --production

# 3. 数据库初始化（首次部署时执行，后续跳过）
echo "[3/7] 检查数据库..."
if [ "$1" = "--init-db" ]; then
  echo "  执行数据库初始化脚本..."
  mysql -u root -p erp_db < scripts/init-database.sql
  echo "  数据库初始化完成"
fi

# 4. 前端构建
echo "[4/7] 构建前端..."
cd $FRONTEND_DIR
npm ci
npm run build

# 5. Nginx 配置
echo "[5/7] 更新 Nginx 配置..."
sudo cp $PROJECT_DIR/deploy/nginx.conf /etc/nginx/sites-available/erp.iptt.top
sudo ln -sf /etc/nginx/sites-available/erp.iptt.top /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. PM2 启动/重启后端
echo "[6/7] 启动后端服务..."
cd $BACKEND_DIR
pm2 startOrRestart ecosystem.config.js --env production

# 7. 验证
echo "[7/7] 验证服务状态..."
sleep 3
pm2 status erp-backend
curl -s -o /dev/null -w "%{http_code}" https://erp.iptt.top/api/v1/auth/profile || true

echo ""
echo "===== 部署完成 ====="
echo "前端: https://erp.iptt.top"
echo "后端: https://erp.iptt.top/api/v1"
echo ""
echo "首次部署后续步骤："
echo "  1. 创建银行账户 + 设置期初余额"
echo "  2. 导入历史数据（/import 页面）"
echo "  3. 配置企业微信回调 URL: https://erp.iptt.top/api/v1/wechat/callback"
echo "  4. 设置 Token 和 EncodingAESKey 到 .env"
