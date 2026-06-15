# LINE AI Assistant

Read `CLAUDE.md` for the project workflow, but follow the Codex-specific rules below when they conflict with Claude-only features

## Setup

When the user says `setup` / `部署` / `deploy` / `設定`, do the whole onboarding for them with the Vercel CLI and your own judgment. Keep their actions to the absolute minimum — ideally they only **approve authorizations and confirm**. Do not make them read commands or open a dashboard.

**You do, end to end (via `npx vercel`, the user installs nothing):** generate `SYNC_SECRET` yourself, deploy to **production** (`--prod`), set the three env vars (`SYNC_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`), provision storage, redeploy, write `BOT_URL` to `.env`, then verify.

**The user only has to:**
1. Open the `vercel login` authorization link you surface, and confirm the device code
2. Paste the LINE **Channel Secret** and **Access Token** — LINE has no CLI, so this is the only thing you cannot get yourself
3. Confirm at the end

**Non-obvious facts you must apply (the rest you already know):**
- Preview deployments are auth-walled — always deploy with `--prod` so the webhook is public
- `vercel login`'s authorization URL + device code may not print to the user on their own — the moment you start login, **copy the URL and device code into your reply, tell the user to open it and confirm, then wait**. Never run login silently; the user cannot guess where to authorize (observed 2026-06-15 fresh-run: setup stalled because the URL was never shown)
- Storage: `vercel integration add upstash` → choose **Upstash for Redis** from the interactive list (a bare `upstash` errors with "Product not found")
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

## Safety

- Keep all secrets in `.env`
- Do not commit `.env`, `logs/`, or downloaded messages
- Do not expose LINE access tokens or user IDs in chat output
- Group messages returned by the API are processed by the Codex model and are not an offline local-only workflow
- Do not deploy, edit code, or clear remote messages unless the user's request requires it
- When using the direct HTTP fallback, clear remote messages only after the response has been received successfully

## Customization

When the user changes the summary format or filtering rules, update this file or `config.json` so the behavior persists across new Codex sessions
