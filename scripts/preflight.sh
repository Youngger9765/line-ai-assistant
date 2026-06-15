#!/bin/bash
# 課前檢查 — 確認所有工具都裝好了

echo "🔍 課前環境檢查"
echo "================================"

PASS=0
FAIL=0

check() {
  if command -v "$1" &> /dev/null; then
    echo "  ✅ $2"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $2 — $3"
    FAIL=$((FAIL + 1))
  fi
}

check "node" "Node.js ($(node -v 2>/dev/null || echo '未安裝'))" "到 https://nodejs.org 下載安裝"
check "npm" "npm ($(npm -v 2>/dev/null || echo '未安裝'))" "裝好 Node.js 就會有"
check "git" "Git ($(git --version 2>/dev/null | cut -d' ' -f3 || echo '未安裝'))" "到 https://git-scm.com 下載"
check "python3" "Python 3 ($(python3 --version 2>/dev/null || echo '未安裝'))" "Codex 會改用系統 HTTP 工具執行 sync"
check "vercel" "Vercel CLI ($(vercel -v 2>/dev/null || echo '未安裝'))" "終端機跑：npm i -g vercel"

echo "================================"
if [ $FAIL -eq 0 ]; then
  echo "🎉 全部通過！可以上課了"
else
  echo "⚠️  $FAIL 項未通過，請先修好再上課"
fi
