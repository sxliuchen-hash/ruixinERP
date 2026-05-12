#!/bin/bash
# ============================================================
# 数据库自动备份到腾讯云 COS
# ============================================================
# 用法：
#   chmod +x scripts/backup-to-cos.sh
#   ./scripts/backup-to-cos.sh
#
# 建议通过 crontab 每日凌晨执行：
#   0 2 * * * /var/www/erp/backend/scripts/backup-to-cos.sh >> /var/www/erp/backend/logs/backup.log 2>&1
#
# 前提：
#   - 已安装 coscmd（pip install coscmd）
#   - 已配置 coscmd（coscmd config -a AKIDxxx -s xxxxx -b bucket -r region）
#   - 或使用 cos-nodejs-sdk（本脚本同时提供 node 版本）
# ============================================================

set -e

# 配置
DB_HOST="localhost"
DB_PORT="3306"
DB_USER="erp_db"
DB_PASSWORD="SjLJw3AMX4yFmiwP"
DB_NAME="erp_db"
BACKUP_DIR="/tmp/erp_backups"
COS_BUCKET="patent-backup-1326598546"
COS_REGION="ap-guangzhou"
KEEP_DAYS=30  # 本地保留天数

# 日期
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="erp_db_${DATE}.sql.gz"

echo "===== ERP 数据库备份 ====="
echo "时间: $(date)"
echo "文件: ${FILENAME}"

# 创建备份目录
mkdir -p ${BACKUP_DIR}

# mysqldump + gzip 压缩
echo "1. 导出数据库..."
mysqldump -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASSWORD} \
  --single-transaction --routines --triggers \
  ${DB_NAME} | gzip > ${BACKUP_DIR}/${FILENAME}

FILESIZE=$(du -h ${BACKUP_DIR}/${FILENAME} | cut -f1)
echo "   大小: ${FILESIZE}"

# 上传到 COS（使用 node 脚本，避免额外安装 coscmd）
echo "2. 上传到 COS..."
node -e "
require('dotenv').config({ path: '/var/www/erp/backend/.env' });
const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const path = require('path');

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY
});

const filePath = '${BACKUP_DIR}/${FILENAME}';
const key = 'erp-backups/db/${FILENAME}';

cos.putObject({
  Bucket: '${COS_BUCKET}',
  Region: '${COS_REGION}',
  Key: key,
  Body: fs.createReadStream(filePath)
}, (err, data) => {
  if (err) {
    console.error('COS 上传失败:', err.message);
    process.exit(1);
  }
  console.log('   COS 上传成功: ' + key);
  process.exit(0);
});
"

# 清理过期本地备份
echo "3. 清理 ${KEEP_DAYS} 天前的本地备份..."
find ${BACKUP_DIR} -name "erp_db_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "===== 备份完成 ====="
