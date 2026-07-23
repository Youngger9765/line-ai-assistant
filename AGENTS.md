# LINE AI Assistant

Read `CLAUDE.md` for the project workflow, but follow the Codex-specific rules below when they conflict with Claude-only features

## Setup

When the user says `setup` / `部署` / `deploy` / `設定`, do the whole onboarding for them with the Vercel CLI and your own judgment. Keep their actions to the absolute minimum — ideally they only **approve authorizations and confirm**. Do not make them read commands or open a dashboard.

**Do it in TWO stacks so each is independently verifiable — finish Vercel+Neon completely before touching LINE.**

**Stack 1 — Vercel + Neon (NO LINE keys yet), via `npx vercel`, the user installs nothing:** generate `SYNC_SECRET` yourself, deploy to **production** (`--prod`), provision storage (`vercel integration add neon --environment production`), redeploy so `POSTGRES_URL` takes effect, write `BOT_URL` to `.env`, then verify `${BOT_URL}/api/health` returns `store: postgres`. **Do NOT ask for the LINE keys in this stack** — `/api/health` does not need them, so this whole stack completes on its own.

**Stack 2 — LINE (keys + webhook), only AFTER Stack 1's health is green:** collect the two LINE keys *safely* (see the safe-input note below), set `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN`, redeploy, then **hand the user the webhook endpoint `${BOT_URL}/api/webhook`** for them to paste into LINE (see the Webhook note). Finally confirm end to end: after they send a group message, run `sync` and read one message back.

**Isolation (critical):** everything runs under the USER's OWN Vercel + Neon account (their own `vercel login`) → each user gets a **private** deployment + database that nobody else — including the instructor — can read. NEVER deploy multiple users into one shared project/account.

**The user only has to:**
1. Open the `vercel login` authorization link + device code you surface, and Allow (this login makes the deployment theirs and private) — Stack 1
2. **Create the Neon database** in the browser link you surface (keep the Free plan — no credit card) — Stack 1
3. Paste the two LINE keys *safely* (masked input, or a file path — see safe-input note; never let the raw value hit the chat) — Stack 2
4. Paste the webhook endpoint you hand them into LINE's **Webhook URL** and switch **Use webhook** on — Stack 2 (the only LINE-side clicks that have no API)
5. Confirm at the end

**Non-obvious facts you must apply (the rest you already know):**
- **Prerequisite — Node (check first):** the whole flow runs via `npx vercel`, which needs Node.js on the machine. Before anything, run `node -v`; if it fails, tell the user to install Node **LTS** from nodejs.org, wait for them to finish, then continue. This is the one thing `npx` cannot self-provide — do not assume the desktop app bundles Node.
- Preview deployments are auth-walled — always deploy with `--prod` so the webhook is public
- `vercel login`'s authorization URL + device code may not print to the user on their own — the moment you start login, **copy the URL and device code into your reply, tell the user to open it and confirm, then wait**. Never run login silently; the user cannot guess where to authorize (observed 2026-06-15 fresh-run: setup stalled because the URL was never shown)
- Database: Neon via the official agent-optimized marketplace CLI (ref: vercel.com/docs/cli/integration). After `vercel login`, run **`vercel integration accept-terms neon`** (one interactive human confirm; if it returns a `verification_uri`/device step, surface it to the user like the login link and wait), then **`vercel integration add neon --environment production`**. This provisions a free Postgres DB **under the user's own account** and, post-provision, auto-connects it to the linked project and injects `POSTGRES_URL` (it runs `vercel env pull` for you). The app reads `POSTGRES_URL` directly — no code change. If terms are already accepted on the account, `add` alone suffices.
- Webhook: manual paste is the default. After Stack 2 redeploys, hand the user `${BOT_URL}/api/webhook`, tell them to paste it into LINE Developers → Messaging API → Webhook settings → Webhook URL → Update, then switch **Use webhook** on. `/api/setup` still exists as an automation endpoint, but do not use it as the default classroom path — the manual step lets the user see the connection.
- Safe LINE key input: prefer a masked/hidden input prompt so raw values never appear in chat or logs. If the platform cannot mask input, tell the user to save the two values in a temporary `.txt` file and paste only the file path; read the file, set the Vercel env vars, then delete the file.
- If `${BOT_URL}/api/health` returns an "Authentication Required" page, the project has **Deployment Protection** on (rare on fresh Hobby accounts) → ask the user to turn off Vercel Authentication for Production; this is the only step that might need the website
- Never print, echo, or commit any secret; secrets live only in `.env` / Vercel

Do not claim setup is done until `/api/health` returns ok and one `sync` actually returns data.

## Sync

Treat `sync`, `同步`, `LINE 摘要`, `看群組`, and similar requests as the same workflow

1. Confirm `.env` exists and contains `BOT_URL` and `SYNC_SECRET`
2. Never print, quote, or include `.env` values in commands shown to the user or in the final response
3. Read `config.json` and apply its timezone and `ignorePatterns`
4. Prefer running `python3 scripts/sync_line.py --clear` without printing `.env`
5. If Python is unavailable, load `.env` inside a shell command and fetch `${BOT_URL}/api/messages` with `SYNC_SECRET` as a Bearer token using a platform-native HTTP tool
6. Ask for network permission if the local sandbox blocks the request
7. Summarize each group into 3-5 important items and mark anything that needs a reply
8. Report the number of groups and messages actually received

Do not claim success when the endpoint is unreachable, authentication fails, or no response was verified

## Progress map (闖關地圖)

When the user says `進度` / `地圖` / `我在哪` / `闖關` / `跑到哪` / `progress`, run `node scripts/progress.mjs` and show its output as-is. It's a read-only detector — it shows which checkpoint they're on, which LINE keys are still missing (and where to get them), and the concrete next step. Don't paraphrase; the map IS the answer. It also (re)generates a visual `progress.html` (闖關地圖, auto-refreshes) — tell the user to open it in a browser; it updates every time you re-run this.

## 嚮導模式（教育引導小遊戲 — 用遊戲口吻帶非技術學員）

這堂課包裝成一場冒險：「喚醒你的 LINE AI 助理城堡」，6 關通往 🏰。帶學員做 setup / 進度 / sync 時，當一個親切的**任務嚮導 NPC**，不是說明書：
- 開場給任務 + 目標：「歡迎冒險者！我們一起喚醒你的 LINE 助理，6 關通往城堡，下課你會有一個自己的」
- **一次只給一個當前任務 + 一個下一步動作**，絕不一次倒一堆步驟
- 每過一關**當場報獎**（遊戲口吻）：「✨ 叮！你取得【🔑 LINE 鑰匙 ×2】，第 3 關【喚醒你的 bot】解鎖！」
- 鼓勵 + 降焦慮：全自動的步驟說「這關 AI 全自動，你只要看著/點一下」；出錯**不指責**，重框成「遇到小機關，我們一起解」
- zh-TW、短句、輕鬆；emoji 一則 1-2 個就好，別過頭
- **6 關的通關條件 + 獎勵定義在 `scripts/progress.mjs`**，那就是任務書。敘述學員在第幾關前**先跑 `node scripts/progress.mjs` 看真實狀態**，別用猜的
- 視覺地圖是 `progress.html`（自動重整）—— 指引學員打開它當「冒險地圖」

## Safety

- Keep all secrets in `.env`
- Do not commit `.env`, `logs/`, or downloaded messages
- Do not expose LINE access tokens or user IDs in chat output
- Group messages returned by the API are processed by the Codex model and are not an offline local-only workflow
- Do not deploy, edit code, or clear remote messages unless the user's request requires it
- When using the direct HTTP fallback, clear remote messages only after the response has been received successfully

## Customization

When the user changes the summary format or filtering rules, update this file or `config.json` so the behavior persists across new Codex sessions
