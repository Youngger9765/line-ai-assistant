#!/bin/bash
# 技術層一鍵驗證 — 部署後確認一切正常（講師驗證版用）
# 涵蓋：Node 前置 → health(store=postgres) → messages API → .env → sync 腳本 → logs

SCRIPT_DIR="$(dirname "$0")"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 .env（還沒部署？先跟 Codex/Claude 說「部署」）"
  exit 1
fi

# 讀 .env
while IFS='=' read -r key value; do
  key=$(echo "$key" | xargs)
  [[ -z "$key" || "$key" == \#* ]] && continue
  export "$key=$value"
done < "$ENV_FILE"

echo "🔍 驗證 LINE AI 助理（技術層）"
echo "================================"

PASS=0
FAIL=0

# 0. Node 前置（最容易在乾淨機器炸的一關）
echo ""
echo "0️⃣  Node 前置（npx vercel 靠它）"
if command -v node &> /dev/null; then
  echo "  ✅ Node 已裝（$(node -v)）"
  PASS=$((PASS + 1))
else
  echo "  ❌ 沒有 Node → 部署一定失敗。到 nodejs.org 裝 LTS 版"
  FAIL=$((FAIL + 1))
fi

# 1. Health check（含 store 後端確認 = 是不是 Neon/Postgres）
echo ""
echo "1️⃣  Health Check"
HEALTH=$(curl -s "https://$BOT_URL/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  STORE=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('store','?'))" 2>/dev/null || echo "?")
  GROUPS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('groups',0))" 2>/dev/null || echo "?")
  if [ "$STORE" = "postgres" ]; then
    echo "  ✅ 服務正常，後端 = $STORE（Neon）✓，$GROUPS 個群組"
    PASS=$((PASS + 1))
  else
    echo "  ⚠️  服務正常但後端 = $STORE（預期 postgres/Neon）—— 確認是不是還在用舊的 upstash"
    echo "     $GROUPS 個群組"
    PASS=$((PASS + 1))
  fi
else
  echo "  ❌ 連不上 https://$BOT_URL/api/health"
  echo "     回傳：$HEALTH"
  FAIL=$((FAIL + 1))
fi

# 2. Messages API（Bearer token 驗證）
echo ""
echo "2️⃣  Messages API（Bearer token）"
MSG=$(curl -s -H "Authorization: Bearer $SYNC_SECRET" "https://$BOT_URL/api/messages" 2>/dev/null)
if echo "$MSG" | grep -q '"totalMessages"'; then
  TOTAL=$(echo "$MSG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalMessages',0))" 2>/dev/null || echo "?")
  echo "  ✅ API 正常，$TOTAL 則待 sync 訊息"
  PASS=$((PASS + 1))
else
  echo "  ❌ Messages API 異常（SYNC_SECRET 對不上？）"
  echo "     回傳：$MSG"
  FAIL=$((FAIL + 1))
fi

# 3. .env 完整性（LINE_USER_ID 只有「推送回 LINE」才需要 → 選用）
echo ""
echo "3️⃣  .env 完整性"
MISSING=""
for VAR in BOT_URL SYNC_SECRET LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN; do
  VAL=$(eval echo "\$$VAR")
  if [ -z "$VAL" ] || echo "$VAL" | grep -q "your_\|xxx\|placeholder"; then
    MISSING="$MISSING $VAR"
  fi
done
if [ -z "$MISSING" ]; then
  echo "  ✅ 必要變數都填好了（LINE_USER_ID 選用，只推送回 LINE 才需要）"
  PASS=$((PASS + 1))
else
  echo "  ❌ 以下必要變數未填或還是 placeholder：$MISSING"
  FAIL=$((FAIL + 1))
fi

# 4. sync 腳本
echo ""
echo "4️⃣  sync 腳本"
if [ -f "$(dirname "$SCRIPT_DIR")/scripts/sync_line.py" ]; then
  echo "  ✅ scripts/sync_line.py 存在"
  PASS=$((PASS + 1))
else
  echo "  ❌ scripts/sync_line.py 不見了"
  FAIL=$((FAIL + 1))
fi

# 5. logs/ 資料夾
echo ""
echo "5️⃣  logs/ 資料夾"
LOGS_DIR="$(dirname "$SCRIPT_DIR")/logs"
if [ -d "$LOGS_DIR" ]; then
  LOG_COUNT=$(find "$LOGS_DIR" -name "*.md" | wc -l | xargs)
  echo "  ✅ logs/ 存在，$LOG_COUNT 個檔案"
  PASS=$((PASS + 1))
else
  echo "  ℹ️  logs/ 還沒建立（第一次 sync 後會自動建）"
  PASS=$((PASS + 1))
fi

echo ""
echo "================================"
echo "結果：$PASS 通過 / $FAIL 失敗"
if [ $FAIL -eq 0 ]; then
  echo "🎉 技術層全過！可以開始 sync 了（體驗層還要人走一遍，見講師驗證清單）"
else
  echo "⚠️  請修好失敗的項目"
fi
