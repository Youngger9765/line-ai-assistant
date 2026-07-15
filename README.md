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

### Step 2：建立 Upstash Redis（資料暫存 — 先建好，部署時要用）

1. 到 [Upstash](https://upstash.com/) 用 GitHub 登入，**Create Database**（Redis，免費，region 選 Tokyo 或 Singapore）
2. 建好後在資料庫頁面複製 **REST URL** 與 **REST TOKEN**（等下設定環境變數用）

> Upstash 免費方案**不會因閒置暫停**（至少 30 天無活動才封存、且會先備份可還原），課堂完全夠 —— 這也是選它不選 Supabase（7 天就暫停）的原因。

### Step 3：部署（二選一，挑一條走到底）

到這裡你手上應該有 4 個值：LINE Channel Secret、LINE Access Token、Upstash REST URL、Upstash REST TOKEN。

**方法 A｜腳本一條龍（推薦）** — 部署 + 灌環境變數 + 註冊 webhook 全自動，`SYNC_SECRET` 也自動產生、不會對不上：

```
git clone https://github.com/Youngger9765/line-ai-assistant
cd line-ai-assistant
bash scripts/setup_env.sh    # 填 LINE×2 + Upstash×2 + User ID（SYNC_SECRET 自動生成）
bash scripts/deploy.sh       # 自動部署 + 灌所有環境變數 + 註冊 LINE webhook
```

**方法 B｜一鍵 button（手動填環境變數）**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYoungger9765%2Fline-ai-assistant&env=LINE_CHANNEL_SECRET,LINE_CHANNEL_ACCESS_TOKEN,SYNC_SECRET,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN)

按下去後，**5 個環境變數一次填齊**（這樣部署完才不會因為缺資料庫就壞掉）：

| 變數名稱 | 值 |
|---------|---|
| `LINE_CHANNEL_SECRET` | 你的 Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 你的 Access Token |
| `SYNC_SECRET` | 隨便打一組密碼（本機 `.env` 等下要用**同一組**）|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |

> ⚠️ 方法 A、方法 B **不要混用** —— 兩邊各自的 `SYNC_SECRET` 會不一樣，sync 會失敗。

### Step 4：開 Webhook + 確認通了

1. 到 LINE Developers → 你的 Channel → **Messaging API**，把 **Use webhook** 打開（**唯一一定要手動的開關**，預設是關的）
2. 註冊 Webhook URL：
   - **方法 A**：`deploy.sh` 已經自動做了，跳過
   - **方法 B**：終端機跑一次 `curl -X POST -H "Authorization: Bearer 你的SYNC_SECRET" https://你的專案.vercel.app/api/setup`，看到 `{ "ok": true }` 即可（SYNC_SECRET 走 header、不放進網址）
3. **確認通了**：打開 `https://你的專案.vercel.app/api/health`
   - 看到 `{"status":"ok","store":"upstash",...}` → 資料庫接好了 ✅
   - 看到 `503` → Upstash 金鑰有問題，回 Step 2/3 檢查

### Step 5：把 Bot 加入群組

1. 在 LINE Developers → Messaging API 頁面，掃描 **QR Code** 加 Bot 為好友
2. 把 Bot 邀請進你想追蹤的 LINE 群組
3. Bot 會開始靜靜地收集訊息（不會主動發言）

> **⚠️ 隱私提醒**：Bot 會收集群組裡的文字訊息。如果你不是群組管理者，請先告知群組成員。建議在群組發一則：「我加了一個 AI 助理，它會幫我整理每天的重點，不會主動發言」

### Step 6：本機 .env（給 Codex sync 用）

- **方法 A**：`setup_env.sh` 已經幫你建好 `.env` 了，這步跳過
- **方法 B**：把 `.env.example` 複製成 `.env`，填入：
  - `BOT_URL` → 你的 Vercel 網址（例如 `my-bot.vercel.app`）
  - `SYNC_SECRET` → **你在 Step 3 button 設的同一組**（不一樣 sync 會 401）
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
