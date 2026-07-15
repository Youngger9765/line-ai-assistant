# LINE AI 群組助理

自動收集 LINE 群組訊息，用 Codex 或 Claude Code 抓取並摘要

## 它做什麼？

1. LINE Bot 加入群組後，自動收集所有文字訊息到雲端暫存
2. 你在自己的電腦打開 Codex，說一聲「sync」
3. Codex 抓取訊息、產出摘要，直接給你看

**不需要 LLM API Key** — 使用你的 ChatGPT/Codex 訂閱額度

## 架構圖

```
LINE 群組訊息 → Webhook → Upstash Redis 暫存
                                ↓
你的電腦：Codex → GET /api/messages → 摘要報告
```

Vercel 與 Upstash Redis 負責收集，Codex 從你的電腦操作並使用 ChatGPT 模型摘要

---

## 前置準備

你需要以下帳號：

- ChatGPT 方案 + Codex 桌面版
- [LINE Developers](https://developers.line.biz/) 帳號
- [Vercel](https://vercel.com/) 帳號（用 GitHub 登入）
- [GitHub](https://github.com/) 帳號

**不需要**：~~OpenAI API Key~~、~~Cron 排程~~

---

## 部署步驟

### Step 1：建立 LINE Bot

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 登入 LINE Business ID
2. 建立一個一般 LINE Official Account，不需要申請認證帳號
3. 打開該帳號 → Settings → **Messaging API** → **Enable Messaging API**
4. 第一次使用 Developers 時，先登記開發者名稱與 Email
5. 建立或選擇 Provider。Provider 綁定後不能更換，個人課堂測試請建立自己的 Provider
6. 啟用後，系統會自動建立 Messaging API channel
7. 回到 [LINE Developers Console](https://developers.line.biz/console/) → Provider → 打開剛建立的 channel
8. 在 Messaging API 頁開啟 **Allow bot to join group chats**
9. 記下這兩個值：
   - **Channel Secret**（在 Basic settings 頁面）
   - **Channel access token (long-lived)**（在 Messaging API 頁面按 Issue，課堂操作最簡單）
10. 在 LINE Official Account Manager 關閉：
   - 關閉 **Auto-reply messages**
   - 關閉 **Greeting messages**

### Step 2：Deploy to Vercel

按下面的按鈕一鍵部署：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYoungger9765%2Fline-ai-assistant&env=LINE_CHANNEL_SECRET,LINE_CHANNEL_ACCESS_TOKEN,SYNC_SECRET&envDescription=LINE%20Bot%20%E9%87%91%E9%91%B0%E5%92%8C%20Sync%20%E5%AF%86%E7%A2%BC&envLink=https%3A%2F%2Fgithub.com%2FYoungger9765%2Fline-ai-assistant%23step-3%E8%A8%AD%E5%AE%9A%E7%92%B0%E5%A2%83%E8%AE%8A%E6%95%B8)

或手動：
1. Fork 這個 repo
2. 用 GitHub 帳號登入 [Vercel](https://vercel.com/)
3. 點選 **Add New → Project**，選你 Fork 的 repo
4. 先設定環境變數（下一步），再按 Deploy

### Step 3：設定環境變數

在 Vercel 的 **Environment Variables** 頁面，加入：

| 變數名稱 | 值 | 哪裡拿？ |
|---------|---|---------|
| `LINE_CHANNEL_SECRET` | 你的 Channel Secret | LINE Developers → Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | 你的 Access Token | LINE Developers → Messaging API |
| `SYNC_SECRET` | 隨便取一個密碼 | 自己決定，例如 `my-secret-123` |

設定完成後，按 **Deploy**

**Upstash Redis 設定：**

1. 到 [Upstash](https://upstash.com/) 用 GitHub 登入，**Create Database**（Redis，免費，region 選 Tokyo 或 Singapore）
2. 建好後在資料庫頁面複製 **REST URL** 與 **REST TOKEN**
3. 回 Vercel → 你的專案 → Settings → **Environment Variables**，加這兩個：

   | 變數名稱 | 值 |
   |---------|---|
   | `UPSTASH_REDIS_REST_URL` | 剛複製的 REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | 剛複製的 REST TOKEN |

4. 重新部署一次（Deployments → 最新的 → **Redeploy**）讓變數生效

> Upstash 免費方案**不會因閒置暫停**，不用擔心 keepalive（這也是選它不選 Supabase 的原因）。

### Step 4：一鍵設定 Webhook（自動）

先到 LINE Developers → 你的 Channel → **Messaging API** 頁面，把 **Use webhook** 打開（開關預設是關的）。

然後打開這個網址**一次**（把兩個值換成你的）：

```
https://你的專案.vercel.app/api/setup?secret=你的SYNC_SECRET
```

它會自動把 Webhook URL 指回你的專案並觸發驗證，看到 `{ "ok": true }` 就完成了 —— 不用自己填 URL、也不用按 Verify。

### Step 5：把 Bot 加入群組

1. 在 LINE Developers → Messaging API 頁面，掃描 **QR Code** 加 Bot 為好友
2. 把 Bot 邀請進你想追蹤的 LINE 群組
3. Bot 會開始靜靜地收集訊息（不會主動發言）

> **⚠️ 隱私提醒**：Bot 會收集群組裡的文字訊息。如果你不是群組管理者，請先告知群組成員。建議在群組發一則：「我加了一個 AI 助理，它會幫我整理每天的重點，不會主動發言」

### Step 6：設定 .env

1. 把 `.env.example` 複製成 `.env`
2. 填入你的值：
   - `BOT_URL` → 你的 Vercel 網址（例如 `my-bot.vercel.app`）
   - `SYNC_SECRET` → 你在 Step 3 設定的 SYNC_SECRET
   - `LINE_CHANNEL_ACCESS_TOKEN` → 你的 LINE Access Token（推送用）
   - `LINE_USER_ID` → 你的 LINE User ID（推送用）

`.env` 已在 `.gitignore` 裡，不會被 push 到 GitHub

---

## 怎麼 Sync

1. 用 Codex 桌面版開啟這個專案資料夾
2. 跟 Codex 說：**「sync」**

Codex 會自動：
- 抓取 Vercel 上暫存的訊息
- 對每個群組產出重要事項摘要
- 把報告顯示在終端機裡

如果你想把摘要推送回 LINE，跟 Codex 說 **「推送」**

---

## 客製化

編輯 `config.json` 可以調整：

| 設定 | 說明 | 預設值 |
|------|------|-------|
| `timezone` | 時區 | `"Asia/Taipei"` |
| `ignorePatterns` | 要忽略的訊息內容 | `["已收回訊息", "照片", "貼圖"]` |

編輯 `AGENTS.md` 可以自訂 Codex 的摘要行為（格式、重點、語言等）

---

## 常見問題

### Webhook Verify 失敗？
- 確認 URL 格式正確：`https://xxx.vercel.app/api/webhook`（結尾沒有 `/`）
- 確認專案已經成功部署

### Sync 抓不到訊息？
- 確認 `.env` 裡的 BOT_URL 和 SYNC_SECRET 已經填好
- 打開 `https://你的專案.vercel.app/api/health` 確認服務正常
- 訊息不會自動過期，sync 後用 `?clear=true` 才會清除

### Bot 不收集訊息？
- 確認 Bot 已經被邀請進群組（不是只加好友）
- 確認 LINE Developers 的 Auto-reply 和 Greeting 都已關閉
- 到 Vercel → Logs 查看 webhook 有沒有收到請求

### 需要 OpenAI API Key 嗎？
不需要。Codex 使用你的 ChatGPT 方案，不必另外申請 API key

### 群組訊息會只留在本機嗎？
不會。Vercel 與 Redis 會暫存原始訊息，sync 後訊息內容會交給 Codex 模型產生摘要。不要用於病歷、金融或其他高度敏感資料

### 費用大概多少？
- **LINE Messaging API**：免費
- **Vercel**：免費方案足夠（Hobby plan）
- **ChatGPT**：依你的訂閱方案
- **OpenAI API**：不需要

---

## 專案結構

```
line-ai-assistant/
├── api/
│   ├── webhook.js      # 接收 LINE 訊息，存入 Redis
│   ├── messages.js     # 提供訊息給 Codex 讀取
│   └── health.js       # 健康檢查
├── AGENTS.md           # Codex 的 sync 指令
├── config.json         # 設定檔
├── vercel.json         # Vercel 部署設定
├── package.json        # 套件管理
├── .env.example        # 環境變數範本
└── README.md           # 就是這份文件
```

---

## License

MIT
