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
#   - 已安装 mysqldump、gzip、sha256sum、flock 和项目 Node 依赖
#   - 已配置独立只读 DB_BACKUP_* 与独立 COS_BACKUP_* 凭证
# ============================================================

set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# 只从受控环境读取敏感值；默认加载部署目录 .env，也可用 ERP_ENV_FILE 覆盖。
ENV_FILE="${ERP_ENV_FILE:-/var/www/erp/backend/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DB_BACKUP_HOST="${DB_BACKUP_HOST:-${DB_HOST:-localhost}}"
DB_BACKUP_PORT="${DB_BACKUP_PORT:-${DB_PORT:-3306}}"
DB_BACKUP_USER="${DB_BACKUP_USER:-}"
DB_BACKUP_NAME="${DB_BACKUP_NAME:-${DB_NAME:-erp_db}}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/erp_backups}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_DIR}/.backup.lock}"
COS_BACKUP_SECRET_ID="${COS_BACKUP_SECRET_ID:-}"
COS_BACKUP_SECRET_KEY="${COS_BACKUP_SECRET_KEY:-}"
COS_BACKUP_BUCKET="${COS_BACKUP_BUCKET:-}"
COS_BACKUP_REGION="${COS_BACKUP_REGION:-}"
KEEP_DAYS="${KEEP_DAYS:-30}"

: "${DB_BACKUP_USER:?缺少独立只读备份账号 DB_BACKUP_USER}"
: "${DB_BACKUP_PASSWORD:?缺少独立只读备份密码 DB_BACKUP_PASSWORD}"
: "${COS_BACKUP_SECRET_ID:?缺少独立备份凭证 COS_BACKUP_SECRET_ID}"
: "${COS_BACKUP_SECRET_KEY:?缺少独立备份凭证 COS_BACKUP_SECRET_KEY}"
: "${COS_BACKUP_BUCKET:?缺少独立备份桶 COS_BACKUP_BUCKET}"
: "${COS_BACKUP_REGION:?缺少备份桶地域 COS_BACKUP_REGION}"

[[ "$DB_BACKUP_PORT" =~ ^[0-9]{1,5}$ ]] || {
  echo "DB_BACKUP_PORT 必须是有效端口" >&2
  exit 2
}
[[ "$DB_BACKUP_NAME" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "DB_BACKUP_NAME 仅允许字母、数字和下划线" >&2
  exit 2
}
[[ "$DB_BACKUP_USER" =~ ^[A-Za-z0-9_.@-]+$ ]] || {
  echo "DB_BACKUP_USER 格式不合法" >&2
  exit 2
}
[[ "$DB_BACKUP_HOST" =~ ^[A-Za-z0-9.:-]+$ ]] || {
  echo "DB_BACKUP_HOST 格式不合法" >&2
  exit 2
}
[[ "$KEEP_DAYS" =~ ^[0-9]{1,4}$ ]] || {
  echo "KEEP_DAYS 必须是 0-9999 的整数" >&2
  exit 2
}
if [ -n "${DB_USER:-}" ] && [ "$DB_BACKUP_USER" = "$DB_USER" ]; then
  echo "DB_BACKUP_USER 不得复用应用 DB_USER" >&2
  exit 2
fi
if [ -n "${COS_BUCKET:-}" ] && [ "${COS_BACKUP_BUCKET,,}" = "${COS_BUCKET,,}" ]; then
  echo "COS_BACKUP_BUCKET 不得复用 ERP 业务 COS_BUCKET" >&2
  exit 2
fi

[ ! -L "$BACKUP_DIR" ] || {
  echo "BACKUP_DIR 不得是符号链接" >&2
  exit 2
}
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[ ! -L "$BACKUP_LOCK_FILE" ] || {
  echo "BACKUP_LOCK_FILE 不得是符号链接" >&2
  exit 2
}

command -v flock >/dev/null 2>&1 || {
  echo "缺少 flock，无法阻止并发备份" >&2
  exit 2
}
exec 9>"$BACKUP_LOCK_FILE"
flock -n 9 || {
  echo "已有备份任务运行，本次退出" >&2
  exit 3
}

# 日期
DATE=$(date +%Y%m%d_%H%M%S)
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FILENAME="erp_db_${DATE}.sql.gz"
BACKUP_FILE="${BACKUP_DIR}/${FILENAME}"
PART_FILE="${BACKUP_FILE}.part"
SHA_FILE="${BACKUP_FILE}.sha256"
RECEIPT_FILE="${BACKUP_FILE}.receipt.json"
OBJECT_KEY="erp-backups/db/${FILENAME}"
DUMP_PROFILE_VERSION="erp-db-full-v1"

echo "===== ERP 数据库备份 ====="
echo "时间: $(date)"
echo "文件: ${FILENAME}"

MYSQL_CNF=$(mktemp "${BACKUP_DIR}/mysql-client.XXXXXX.cnf")
cleanup() {
  rm -f "$MYSQL_CNF" "${PART_FILE:-}"
}
trap cleanup EXIT
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' \
  "$DB_BACKUP_USER" "$DB_BACKUP_PASSWORD" "$DB_BACKUP_HOST" "$DB_BACKUP_PORT" > "$MYSQL_CNF"
chmod 600 "$MYSQL_CNF"

SOURCE_SERVER_UUID=$(mysql --defaults-extra-file="$MYSQL_CNF" \
  --batch --raw --skip-column-names \
  --execute='SELECT @@server_uuid')
[[ "$SOURCE_SERVER_UUID" =~ ^[A-Za-z0-9-]{8,128}$ ]] || {
  echo "源数据库 server_uuid 读取失败" >&2
  exit 4
}

# mysqldump + gzip 压缩
echo "1. 导出数据库..."
mysqldump --defaults-extra-file="$MYSQL_CNF" \
  --single-transaction --skip-lock-tables --quick \
  --routines --triggers --events --hex-blob \
  --no-tablespaces --set-gtid-purged=OFF --no-create-db \
  --default-character-set=utf8mb4 \
  "$DB_BACKUP_NAME" | gzip > "$PART_FILE"

test -s "$PART_FILE"
gzip -t "$PART_FILE"
BACKUP_SHA256=$(sha256sum "$PART_FILE" | awk '{print $1}')
[[ "$BACKUP_SHA256" =~ ^[a-f0-9]{64}$ ]] || {
  echo "备份 SHA256 计算失败" >&2
  exit 4
}
mv -f "$PART_FILE" "$BACKUP_FILE"
printf '%s  %s\n' "$BACKUP_SHA256" "$FILENAME" > "$SHA_FILE"
chmod 600 "$BACKUP_FILE" "$SHA_FILE"

BACKUP_SIZE=$(wc -c < "$BACKUP_FILE" | tr -d '[:space:]')
FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "   大小: ${FILESIZE}"
echo "   SHA256: ${BACKUP_SHA256}"

# 上传到 COS，并用 HEAD 校验大小和 SHA256 元数据。
echo "2. 上传到 COS并回读元数据..."
BACKUP_FILE="$BACKUP_FILE" \
BACKUP_SIZE="$BACKUP_SIZE" \
BACKUP_SHA256="$BACKUP_SHA256" \
BACKUP_OBJECT_KEY="$OBJECT_KEY" \
BACKUP_DIR="$BACKUP_DIR" \
BACKUP_RECEIPT_PATH="$RECEIPT_FILE" \
BACKUP_CREATED_AT="$CREATED_AT" \
BACKUP_DATABASE_NAME="$DB_BACKUP_NAME" \
BACKUP_SOURCE_SERVER_UUID="$SOURCE_SERVER_UUID" \
BACKUP_DUMP_PROFILE_VERSION="$DUMP_PROFILE_VERSION" \
node "$SCRIPT_DIR/upload-backup-to-cos.js"

# 清理过期本地备份
echo "3. 清理 ${KEEP_DAYS} 天前的本地备份..."
while IFS= read -r -d '' EXPIRED_BACKUP; do
  rm -f -- "$EXPIRED_BACKUP" \
    "${EXPIRED_BACKUP}.sha256" \
    "${EXPIRED_BACKUP}.receipt.json"
done < <(find "$BACKUP_DIR" -type f -name "erp_db_*.sql.gz" \
  -mtime "+${KEEP_DAYS}" -print0)

echo "===== 备份完成 ====="
