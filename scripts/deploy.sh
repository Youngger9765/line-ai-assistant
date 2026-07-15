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
if [ -n "$UPSTASH_REDIS_REST_URL" ] && [ -n "$UPSTASH_REDIS_REST_TOKEN" ]; then
  echo "$UPSTASH_REDIS_REST_URL" | vercel env add UPSTASH_REDIS_REST_URL production --yes 2>/dev/null || true
  echo "$UPSTASH_REDIS_REST_TOKEN" | vercel env add UPSTASH_REDIS_REST_TOKEN production --yes 2>/dev/null || true
else
  echo "  ⚠️  .env 沒有 Upstash 變數 —— 請先在 upstash.com 建 Redis、把 REST URL/TOKEN 填進 .env（跑 scripts/setup_env.sh）"
fi

# 5. 重新部署（讓環境變數生效）
echo "  🔄 重新部署（讓環境變數生效）..."
vercel deploy --prod --yes

# 6. 抓網址
DEPLOY_URL=$(vercel inspect 2>/dev/null | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | head -1)

# 7. 自動註冊 LINE Webhook（省掉手動去 Console 貼 URL + 按 Verify）
if [ -n "$DEPLOY_URL" ] && [ -n "$SYNC_SECRET" ]; then
  echo "  🔗 自動設定 LINE Webhook..."
  curl -s -H "Authorization: Bearer $SYNC_SECRET" "$DEPLOY_URL/api/setup" || true
  echo ""
fi

echo ""
echo "✅ 部署完成！"
echo "   你的網址：${DEPLOY_URL:-請到 Vercel Dashboard 查看}"
echo ""
echo "下一步：到 LINE Developers → Messaging API 把「Use webhook」打開（若還沒），再把 Bot 加進群組"
