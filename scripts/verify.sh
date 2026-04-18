#!/bin/bash
# 驗證一切正常 — 檢查部署、webhook、KV

SCRIPT_DIR="$(dirname "$0")"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 .env"
  exit 1
fi

# 讀 .env
while IFS='=' read -r key value; do
  key=$(echo "$key" | xargs)
  [[ -z "$key" || "$key" == \#* ]] && continue
  export "$key=$value"
done < "$ENV_FILE"

echo "🔍 驗證 LINE AI 助理"
echo "================================"

PASS=0
FAIL=0

# 1. Health check
echo ""
echo "1️⃣  Health Check"
HEALTH=$(curl -s "https://$BOT_URL/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  GROUPS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('groups',0))" 2>/dev/null || echo "?")
  echo "  ✅ 服務正常，$GROUPS 個群組"
  PASS=$((PASS + 1))
else
  echo "  ❌ 連不上 https://$BOT_URL/api/health"
  echo "     回傳：$HEALTH"
  FAIL=$((FAIL + 1))
fi

# 2. Messages API
echo ""
echo "2️⃣  Messages API（Bearer token 驗證）"
MSG=$(curl -s -H "Authorization: Bearer $SYNC_SECRET" "https://$BOT_URL/api/messages" 2>/dev/null)
if echo "$MSG" | grep -q '"totalMessages"'; then
  TOTAL=$(echo "$MSG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalMessages',0))" 2>/dev/null || echo "?")
  echo "  ✅ API 正常，$TOTAL 則待 sync 訊息"
  PASS=$((PASS + 1))
else
  echo "  ❌ Messages API 異常"
  echo "     回傳：$MSG"
  FAIL=$((FAIL + 1))
fi

# 3. .env 完整性
echo ""
echo "3️⃣  .env 完整性"
MISSING=""
for VAR in BOT_URL LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN SYNC_SECRET LINE_USER_ID; do
  VAL=$(eval echo "\$$VAR")
  if [ -z "$VAL" ] || echo "$VAL" | grep -q "your_\|xxx\|placeholder"; then
    MISSING="$MISSING $VAR"
  fi
done
if [ -z "$MISSING" ]; then
  echo "  ✅ 所有變數都填好了"
  PASS=$((PASS + 1))
else
  echo "  ❌ 以下變數未填或還是 placeholder：$MISSING"
  FAIL=$((FAIL + 1))
fi

# 4. sync_line.py
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
  echo "🎉 全部正常！可以開始 sync 了"
else
  echo "⚠️  請修好失敗的項目"
fi
