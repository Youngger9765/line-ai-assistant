#!/bin/bash
# 部署到 Vercel — 讀 .env 自動設定所有環境變數

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 .env，請先跑 bash scripts/setup_env.sh"
  exit 1
fi

# 讀 .env
source_env() {
  while IFS='=' read -r key value; do
    key=$(echo "$key" | xargs)
    [[ -z "$key" || "$key" == \#* ]] && continue
    export "$key=$value"
  done < "$ENV_FILE"
}
source_env

echo "🚀 部署 LINE AI 助理到 Vercel"
echo "================================"

# 1. 確認 vercel CLI
if ! command -v vercel &> /dev/null; then
  echo "  📦 安裝 vercel CLI..."
  npm i -g vercel
fi

# 2. 登入（如果沒登入過）
echo "  🔑 確認 Vercel 登入..."
vercel whoami 2>/dev/null || vercel login

# 3. 部署
echo "  🚀 部署中..."
cd "$PROJECT_DIR"
vercel deploy --prod --yes

# 4. 設定環境變數
echo "  🔧 設定環境變數..."
echo "$LINE_CHANNEL_SECRET" | vercel env add LINE_CHANNEL_SECRET production --yes 2>/dev/null || true
echo "$LINE_CHANNEL_ACCESS_TOKEN" | vercel env add LINE_CHANNEL_ACCESS_TOKEN production --yes 2>/dev/null || true
echo "$SYNC_SECRET" | vercel env add SYNC_SECRET production --yes 2>/dev/null || true

# 5. 建 KV
echo "  💾 建立 KV 資料庫..."
vercel storage create kv line-messages 2>/dev/null || echo "  （KV 可能已存在，跳過）"

# 6. 重新部署（讓 env + KV 生效）
echo "  🔄 重新部署..."
vercel deploy --prod --yes

echo ""
echo "✅ 部署完成！"
echo "   你的網址：$(vercel inspect 2>/dev/null | grep 'Production' | head -1 || echo '請到 Vercel Dashboard 查看')"
echo ""
echo "下一步：到 LINE Developers 設定 Webhook URL"
