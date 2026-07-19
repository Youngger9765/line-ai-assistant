# LINE AI 群組助理

自動收集 LINE 群組訊息，用 Codex 或 Claude Code 抓取並摘要

## 它做什麼？

1. LINE Bot 加入群組後，自動收集所有文字訊息到雲端暫存
2. 你在自己的電腦打開 Codex，說一聲「sync」
3. Codex 抓取訊息、產出摘要，直接給你看

**不需要 LLM API Key** — 使用你的 ChatGPT/Codex 訂閱額度

## 架構圖

```
LINE 群組訊息 → Webhook → Neon (Postgres) 暫存
                                ↓
你的電腦：ChatGPT(Codex 模式) → GET /api/messages → 摘要報告
```

Vercel 與 Neon (Postgres) 負責收集，你在新版 ChatGPT 桌面版切到 Codex 模式、從自己電腦操作並用 ChatGPT 模型摘要

---

## 前置準備

你需要以下帳號：

- ChatGPT 方案 + **新版 ChatGPT 桌面版**（已內含 Codex 模式；舊獨立 Codex app 已停用，2026/7 起整合進 ChatGPT，左上角切 Chat / Work / Codex）
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

### Step 2：部署 —— 跟 Codex 說一聲「部署」

打開**新版 ChatGPT 桌面版**、左上角切到 **Codex 模式**，開啟（或拖入）這個專案資料夾，跟它說 **「部署」**（或 `setup` / `deploy`）。

**Codex 會自動做完**（你不用開終端機打指令、不用進 Vercel 後台）：
- 產生 `SYNC_SECRET`、部署到 Vercel production、設定環境變數
- 裝 **Neon (Postgres)**（資料暫存，免費、免綁卡、閒置自動休眠不會被停權）
- 自動把 **LINE Webhook** 指回你的專案並驗證
- 把 `BOT_URL` 寫進 `.env`、最後打 `/api/health` 確認接通

**你只要做 4 件事（其餘 Codex 全包）**：
1. 打開 Codex 給你的 **Vercel 登入連結**，授權（確認 device code）
2. **同意一次 Neon 條款**（第一次裝 Neon 時 Codex 會給你一個網址，點進去按同意，之後不用再點）
3. 貼上 LINE 的 **Channel Secret** 和 **Access Token**（LINE 沒有 CLI，只有這個 Codex 拿不到）
4. 最後確認

> 不想用 Codex？見文末「手動部署（備援）」。

### Step 3：打開 LINE 的「Use webhook」開關

Codex 已經幫你把 Webhook URL 填好、也驗證過了，但 LINE 的 **Use webhook** 開關**沒有 API 可以切**，只能手動開一次：

到 LINE Developers → 你的 Channel → **Messaging API** → 把 **Use webhook** 打開。

> 這是整個流程裡**唯一一定要手動點的**東西。

### Step 4：把 Bot 加入群組

1. 在 LINE Developers → Messaging API 頁面，掃描 **QR Code** 加 Bot 為好友
2. 把 Bot 邀請進你想追蹤的 LINE 群組
3. Bot 會開始靜靜地收集訊息（不會主動發言）

> **⚠️ 隱私提醒**：Bot 會收集群組裡的文字訊息。如果你不是群組管理者，請先告知群組成員。建議在群組發一則：「我加了一個 AI 助理，它會幫我整理每天的重點，不會主動發言」

---

## 手動部署（備援 — 不用 Codex 時）

Codex 拿不到的只有 LINE 那兩個值，其餘都能自動；下面是不用 Codex 的兩條路。

**A｜腳本**（要有 Node + 終端機）

```
git clone https://github.com/Youngger9765/line-ai-assistant
cd line-ai-assistant
bash scripts/setup_env.sh    # 填 LINE×2 + User ID（SYNC_SECRET 自動生成）
bash scripts/deploy.sh       # 部署 + 灌 env + 裝 Neon 整合 + 註冊 webhook
```

**B｜一鍵 button**（純網頁）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYoungger9765%2Fline-ai-assistant&env=LINE_CHANNEL_SECRET,LINE_CHANNEL_ACCESS_TOKEN,SYNC_SECRET)

1. 按 button，填 3 個 env（`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`SYNC_SECRET` 自訂一組）→ Deploy
2. 到 Vercel 專案 → **Storage** → 裝 **Neon**（會自動注入 `POSTGRES_URL`；第一次需在瀏覽器同意一次條款）→ **Redeploy**
3. 註冊 webhook：`curl -X POST -H "Authorization: Bearer 你的SYNC_SECRET" https://你的專案.vercel.app/api/setup`（secret 走 header、不放進網址）

**共同：本機 `.env`（給 sync 用）** — 把 `.env.example` 複製成 `.env`，`SYNC_SECRET` 填**與部署時同一組**、`BOT_URL` 填你的 Vercel 網址、再加 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_USER_ID`。腳本路徑（A）的 `.env` 已由 `setup_env.sh` 建好。

**驗收**：打開 `https://你的專案.vercel.app/api/health`，看到 `{"status":"ok","store":"postgres",...}` 就是通了（Neon 走 Postgres，所以顯示 `postgres`）；`503` 代表資料庫沒接好。

`.env` 已在 `.gitignore` 裡，不會被 push 到 GitHub

---

## 怎麼 Sync

1. 用新版 ChatGPT 桌面版（Codex 模式）開啟這個專案資料夾
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
不會。Vercel 與 Neon 資料庫會暫存原始訊息，sync 後訊息內容會交給 Codex 模型產生摘要。不要用於病歷、金融或其他高度敏感資料

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
│   ├── webhook.js      # 接收 LINE 訊息，存入 Neon (Postgres)
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
