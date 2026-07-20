#!/bin/bash
# 課程闖關地圖 — 學員說「進度 / 地圖 / 我在哪 / 闖關」時，agent 跑這支
# 偵測「這台電腦現在跑到哪一關 + 還缺什麼鑰匙 + 下一步做什麼」
# 唯讀，不改任何東西；沒 .env、沒部署都能跑（會告訴你還沒開始）

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# ---- 讀 .env（若存在）----
BOT_URL=""; SYNC_SECRET=""; LINE_CHANNEL_SECRET=""; LINE_CHANNEL_ACCESS_TOKEN=""; LINE_USER_ID=""
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    k=$(echo "$k" | xargs); [[ -z "$k" || "$k" == \#* ]] && continue
    case "$k" in
      BOT_URL) BOT_URL="$v" ;;
      SYNC_SECRET) SYNC_SECRET="$v" ;;
      LINE_CHANNEL_SECRET) LINE_CHANNEL_SECRET="$v" ;;
      LINE_CHANNEL_ACCESS_TOKEN) LINE_CHANNEL_ACCESS_TOKEN="$v" ;;
      LINE_USER_ID) LINE_USER_ID="$v" ;;
    esac
  done < "$ENV_FILE"
fi
filled(){ [ -n "$1" ] && ! echo "$1" | grep -qi 'your_\|xxx\|placeholder'; }

# ---- 偵測每一關 ----
command -v node &>/dev/null && HAS_NODE=1 || HAS_NODE=0
[ -f "$ROOT/package.json" ] && HAS_PROJ=1 || HAS_PROJ=0
( filled "$LINE_CHANNEL_SECRET" && filled "$LINE_CHANNEL_ACCESS_TOKEN" ) && HAS_KEYS=1 || HAS_KEYS=0

HEALTH=""; STORE=""; GROUPS=0; HEALTH_OK=0
if filled "$BOT_URL"; then
  HEALTH=$(curl -s --max-time 8 "https://$BOT_URL/api/health" 2>/dev/null)
  if echo "$HEALTH" | grep -q '"ok"'; then
    HEALTH_OK=1
    STORE=$(echo "$HEALTH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('store',''))" 2>/dev/null)
    GROUPS=$(echo "$HEALTH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('groups',0))" 2>/dev/null || echo 0)
  fi
fi
{ filled "$BOT_URL" && [ "$HEALTH_OK" = 1 ]; } && DEPLOYED=1 || DEPLOYED=0
[ "$STORE" = "postgres" ] && NEON=1 || NEON=0
[ "${GROUPS:-0}" -gt 0 ] 2>/dev/null && RECEIVING=1 || RECEIVING=0
{ [ -d "$ROOT/logs" ] && [ "$(find "$ROOT/logs" -name '*.md' 2>/dev/null | wc -l | xargs)" -gt 0 ]; } && SYNCED=1 || SYNCED=0

# 關卡 done 狀態（1=過）
C1=$(( HAS_NODE==1 && HAS_PROJ==1 ? 1 : 0 ))
C2=$HAS_KEYS
C3=$DEPLOYED
C4=$NEON
C5=$RECEIVING
C6=$SYNCED

LABELS=(
  "環境準備｜Node + 課程資料夾就位"
  "拿到你的兩把 LINE 鑰匙"
  "部署上線｜你的 bot 網址活著"
  "資料庫接好｜Neon (Postgres)"
  "LINE 接通 + 開始收群訊息"
  "第一次 sync｜看到群摘要"
)
STATES=($C1 $C2 $C3 $C4 $C5 $C6)

# 找目前這一關（第一個沒過的）
CURRENT=0
for i in 0 1 2 3 4 5; do
  if [ "${STATES[$i]}" = 0 ]; then CURRENT=$i; break; fi
  CURRENT=6
done

echo "🗺️  你的 LINE AI 助理 — 闖關地圖"
echo "════════════════════════════════════════"
# 闖關照順序：卡在第一個沒過的關；它之前全算過、之後一律鎖住
# （這樣不會出現「還沒部署卻顯示已 sync」的矛盾，也對舊殘留狀態免疫）
for i in 0 1 2 3 4 5; do
  n=$((i+1))
  if [ "$i" -lt "$CURRENT" ]; then icon="✅"
  elif [ "$i" = "$CURRENT" ]; then icon="📍"
  else icon="🔒"; fi
  line="$icon 關卡$n  ${LABELS[$i]}"
  [ "$i" = "$CURRENT" ] && line="$line   ← 你在這裡"
  echo "$line"
done
if [ "$CURRENT" = 6 ]; then
  echo "🎓 關卡7  客製化畢業｜把助理改成你要的樣子（自由關）"
else
  echo "🎓 關卡7  客製化畢業（先過前面幾關）"
fi
echo "════════════════════════════════════════"

# ---- 鑰匙盤點 ----
echo ""
echo "🔑 鑰匙盤點"
if filled "$LINE_CHANNEL_SECRET"; then echo "  ✅ LINE Channel Secret（已有）"
  else echo "  ⬜ LINE Channel Secret ← 去 LINE Developers → Basic settings 複製"; fi
if filled "$LINE_CHANNEL_ACCESS_TOKEN"; then echo "  ✅ LINE Access Token（已有）"
  else echo "  ⬜ LINE Access Token ← 去 LINE Developers → Messaging API → Issue"; fi
if filled "$SYNC_SECRET"; then echo "  ✅ SYNC_SECRET（部署時自動生成）"
  else echo "  ⬜ SYNC_SECRET（部署時 AI 會自動生，你不用管）"; fi
if filled "$BOT_URL"; then echo "  ✅ BOT_URL（已有，部署時自動填）"
  else echo "  ⬜ BOT_URL（部署成功後自動填，你不用管）"; fi

# ---- 下一步 ----
echo ""
echo "👉 下一步"
case "$CURRENT" in
  0) [ "$HAS_NODE" = 0 ] && echo "  先裝 Node（nodejs.org 下載 LTS），再回來" || echo "  在 ChatGPT 切到 Codex、把課程資料夾拖進來" ;;
  1) echo "  去 LINE Developers 建你的官方帳號，拿 Channel Secret + Access Token（兩把鑰匙）" ;;
  2) echo "  跟 Codex 說「部署」→ 授權登入一次 → 貼上你的兩把鑰匙 → 它會自動幫你上線" ;;
  3) echo "  已上線但沒接到 Neon → 跟 Codex 說「重新部署」或「接資料庫」" ;;
  4) echo "  去 LINE 開「Use webhook」開關 + 把 bot 邀進你的群，發幾句話" ;;
  5) echo "  跟 Codex 說「sync」，看它把群訊息整理成重點" ;;
  6) echo "  🎉 都通了！跟 Codex 說人話改摘要格式 / 加功能，做出你自己的助理" ;;
esac
echo ""
