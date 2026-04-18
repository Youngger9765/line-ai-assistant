# LINE AI 助理

## 互動引導（用 AskUserQuestion）

### 第一次開啟
如果 `.env` 不存在，先印歡迎詞：

```
👋 歡迎使用 LINE AI 助理！

我是你的 AI 工程師，接下來我會幫你：
1. 設定環境（問你幾個值，1 分鐘）
2. 部署到雲端（全自動，3 分鐘）
3. 驗證一切正常

你不需要寫任何程式碼，跟著我走就好
```

然後用 AskUserQuestion 問：
- 「開始設定」→ 跑 `bash scripts/preflight.sh` → `bash scripts/setup_env.sh` → `bash scripts/deploy.sh` → `bash scripts/verify.sh`
- 「我已經設定過了」→ 跳過

### sync 完成後
用 AskUserQuestion 問：
- 「推送到 LINE」→ 執行推送指令
- 「不用，看完了」→ 結束

### 腳本失敗時
用 AskUserQuestion 問：
- 「幫我查錯誤」→ 讀 Vercel logs 或錯誤訊息排除
- 「重試一次」→ 重新跑失敗的腳本
- 「跳過這步」→ 繼續下一步

---

## 可用腳本

| 指令 | 腳本 | 做什麼 |
|------|------|--------|
| 檢查環境 | `bash scripts/preflight.sh` | 確認 node/npm/git/claude/vercel 都裝好 |
| 設定 .env | `bash scripts/setup_env.sh` | 互動式問值，自動生 SYNC_SECRET |
| 部署 | `bash scripts/deploy.sh` | 讀 .env → vercel deploy → 設 env → 建 KV |
| 驗證 | `bash scripts/verify.sh` | 檢查部署+API+.env 是否正常 |
| sync | `python3 scripts/sync_line.py --clear` | 抓訊息 → 存檔 → 清 KV |

---

## Sync 指令

當我提到 sync、同步、sync line、LINE 摘要、看群組、今天有什麼訊息，或任何跟抓 LINE 訊息相關的意思：

### 1. 跑 sync 腳本
```bash
python3 scripts/sync_line.py --clear
```

### 2. 摘要
讀 logs/ 裡今天的 .md 檔，對每個群組：
- 列出最重要的 3-5 件事（一句話摘要）
- 標記需要回覆的訊息
- 忽略閒聊和貼圖

### 3. 報告
```
📋 LINE 群組日報 — {今天日期}

【{群組名}】({N} 則訊息)
1. {重要事項}
2. {重要事項}
⚠️ 需要回覆：{內容}
```

---

## 推送指令

當我說「推送」「傳到 LINE」「推給我」或類似意思，讀 .env 拿 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_USER_ID，把最近的摘要用 LINE Push API 傳到我的 LINE

---

## 設定

所有 secrets 在 `.env`（已 .gitignore）：
- BOT_URL — Vercel 網址
- SYNC_SECRET — Vercel 上設的 SYNC_SECRET
- LINE_CHANNEL_ACCESS_TOKEN — LINE Access Token
- LINE_USER_ID — LINE User ID
