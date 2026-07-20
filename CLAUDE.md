# LINE AI Assistant (Claude Code)

Same workflow as `AGENTS.md` — this file is for **Claude Code Desktop** users (open this folder in the app's **Code** tab). Where Claude and Codex differ, the Claude-specific note wins.

## Setup

When the user says `setup` / `部署` / `deploy` / `設定`, do the whole onboarding for them with the Vercel CLI and your own judgment. Keep their actions to the absolute minimum — ideally they only **approve authorizations and confirm**. Do not make them read commands or open a dashboard.

**Isolation (critical):** everything runs under the USER's OWN Vercel + Neon account (their own `vercel login`) → each user gets a **private** deployment + database that nobody else — including the instructor — can read. NEVER deploy multiple users into one shared project/account.

**You do, end to end (via `npx vercel`, the user installs nothing):** generate `SYNC_SECRET` yourself, deploy to **production** (`--prod`), set the three env vars (`SYNC_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`), provision storage, redeploy, **register the LINE webhook** (`curl -X POST -H "Authorization: Bearer $SYNC_SECRET" "$BOT_URL/api/setup"` — the app points LINE's webhook back at itself), write `BOT_URL` to `.env`, then verify.

**The user only has to:**
1. Open the `vercel login` authorization link you surface, and confirm the device code (this login is what makes the deployment theirs and private — after it, you run everything else for them)
2. **Accept the Neon marketplace terms once** in the link you surface (first-time only per account)
3. Paste the LINE **Channel Secret** and **Access Token** — LINE has no CLI, so this is the only thing you cannot get yourself
4. Confirm at the end

**Non-obvious facts you must apply:**
- **Prerequisite — Node (check first):** the whole flow runs via `npx vercel`, which needs Node.js on the machine. Before anything, run `node -v`; if it fails, tell the user to install Node **LTS** from nodejs.org, wait, then continue. This is the one thing `npx` cannot self-provide — do not assume the desktop app bundles Node.
- Preview deployments are auth-walled — always deploy with `--prod` so the webhook is public
- `vercel login`'s authorization URL + device code may not print on their own — the moment you start login, **copy the URL and device code into your reply, tell the user to open it and confirm, then wait**. Never run login silently
- Storage: Neon via the official agent-optimized marketplace CLI (ref: vercel.com/docs/cli/integration). After `vercel login`, run **`vercel integration accept-terms neon`** (one interactive human confirm; if it returns a `verification_uri`/device step, surface it like the login link and wait), then **`vercel integration add neon --environment production`**. This provisions a free Postgres DB **under the user's own account** and, post-provision, auto-connects it to the linked project and injects `POSTGRES_URL` (it runs `vercel env pull`). `lib/redis.js` reads `POSTGRES_URL` — no code change. Do NOT use Upstash (its Vercel integration has no free tier)
- Webhook: after deploy, register it by POSTing to `${BOT_URL}/api/setup` with the `Authorization: Bearer $SYNC_SECRET` header (self-registers LINE's webhook using the channel token + platform host env — pass the secret in the header, never in the URL). The LINE **Use webhook** toggle is not API-settable → tell the user to switch it on once in the Messaging API page (the only LINE-side click they cannot avoid)
- If `${BOT_URL}/api/health` returns an "Authentication Required" page, the project has **Deployment Protection** on → ask the user to turn off Vercel Authentication for Production
- Never print, echo, or commit any secret; secrets live only in `.env` / Vercel

Do not claim setup is done until `/api/health` returns ok and one `sync` actually returns data.

> Claude Code Desktop note: you can run the commands above in the app's integrated terminal / agent. Same flow as the CLI — the user still only authorizes login, accepts Neon terms, and pastes the LINE keys.

## Sync

Treat `sync`, `同步`, `LINE 摘要`, `看群組`, and similar as the same workflow:

1. Confirm `.env` exists and contains `BOT_URL` and `SYNC_SECRET`
2. Never print, quote, or include `.env` values in commands shown to the user or in the final response
3. Read `config.json` and apply its timezone and `ignorePatterns`
4. Prefer running `python3 scripts/sync_line.py --clear` without printing `.env`
5. If Python is unavailable, load `.env` inside a shell command and fetch `${BOT_URL}/api/messages` with `SYNC_SECRET` as a Bearer token
6. Summarize each group into 3-5 important items, mark anything needing a reply, ignore chit-chat/stickers
7. Report the number of groups and messages actually received

Report format:

```
📋 LINE 群組日報 — {今天日期}

【{群組名}】({N} 則訊息)
1. {重要事項}
2. {重要事項}
⚠️ 需要回覆：{內容}
```

Do not claim success when the endpoint is unreachable, authentication fails, or no response was verified.

## Push (optional)

When the user says 「推送」「傳到 LINE」「推給我」, read `.env` for `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_USER_ID`, and push the latest summary via the LINE Push API. Never expose the token in output.

## Progress map (闖關地圖)

When the user says `進度` / `地圖` / `我在哪` / `闖關` / `跑到哪` / `progress`, run `node scripts/progress.mjs` and show its output as-is. It's a read-only detector — it shows which checkpoint they're on, which LINE keys are still missing (and where to get them), and the concrete next step. Don't paraphrase; the map IS the answer.

## Safety

- Keep all secrets in `.env` (already gitignored); never commit `.env`, `logs/`, or downloaded messages
- Do not expose LINE access tokens or user IDs in chat output
- Group messages are processed by the model (not an offline local-only workflow) — only use non-sensitive test groups whose members were told
- Do not deploy, edit code, or clear remote messages unless the user's request requires it

## Customization

When the user changes the summary format or filtering rules, update this file or `config.json` so the behavior persists across sessions.
