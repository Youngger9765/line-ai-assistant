#!/bin/bash
# 建立 .env — 互動式問學員填值

ENV_FILE="$(dirname "$0")/../.env"

if [ -f "$ENV_FILE" ]; then
  echo "⚠️  .env 已存在，要覆蓋嗎？(y/N)"
  read -r confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "取消"
    exit 0
  fi
fi

echo "📝 設定你的 .env（所有值都不會進 git）"
echo "================================"

read -p "你的 Vercel 網址（例如 line-ai-assistant-xxx.vercel.app）: " BOT_URL
read -p "你的 LINE Channel Secret: " LINE_CHANNEL_SECRET
read -p "你的 LINE Channel Access Token: " LINE_CHANNEL_ACCESS_TOKEN
read -p "你的 LINE User ID（Basic settings 最下面的 U 開頭）: " LINE_USER_ID
read -p "你的 Upstash REST URL（Upstash 資料庫頁複製）: " UPSTASH_REDIS_REST_URL
read -p "你的 Upstash REST TOKEN: " UPSTASH_REDIS_REST_TOKEN

# 自動生成 SYNC_SECRET（不用自己想密碼）
SYNC_SECRET=$(openssl rand -hex 16 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(16))")

cat > "$ENV_FILE" << EOF
# === Vercel 部署用 ===
LINE_CHANNEL_SECRET=$LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN=$LINE_CHANNEL_ACCESS_TOKEN
SYNC_SECRET=$SYNC_SECRET
UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN

# === 本機 sync 用 ===
BOT_URL=$BOT_URL
LINE_USER_ID=$LINE_USER_ID
EOF

echo ""
echo "✅ .env 建好了"
echo "   SYNC_SECRET 已自動生成：$SYNC_SECRET"
echo "   （等下部署時會用到這個值）"
