# LINE AI Assistant

Read `CLAUDE.md` for the project workflow, but follow the Codex-specific rules below when they conflict with Claude-only features

## Setup

When the user says `setup` / `部署` / `deploy` / `設定`, do the whole onboarding for them with the Vercel CLI and your own judgment. Keep their actions to the absolute minimum — ideally they only **approve authorizations and confirm**. Do not make them read commands or open a dashboard.

**You do, end to end (via `npx vercel`, the user installs nothing):** generate `SYNC_SECRET` yourself, deploy to **production** (`--prod`), set the three env vars (`SYNC_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`), provision storage (`vercel integration add neon`), redeploy, **register the LINE webhook** (`curl -X POST -H "Authorization: Bearer $SYNC_SECRET" "$BOT_URL/api/setup"` — the app points LINE's webhook back at itself), write `BOT_URL` to `.env`, then verify.

**Isolation (critical):** everything runs under the USER's OWN Vercel + Neon account (their own `vercel login`) → each user gets a **private** deployment + database that nobody else — including the instructor — can read. NEVER deploy multiple users into one shared project/account.

**The user only has to:**
1. Open the `vercel login` authorization link you surface, and confirm the device code (this login is what makes the deployment theirs and private — after it, you run everything else for them)
2. **Accept the Neon marketplace terms once** in the browser link you surface (first-time only per account)
3. Paste the LINE **Channel Secret** and **Access Token** — LINE has no CLI, so this is the only thing you cannot get yourself
4. Confirm at the end

**Non-obvious facts you must apply (the rest you already know):**
- **Prerequisite — Node (check first):** the whole flow runs via `npx vercel`, which needs Node.js on the machine. Before anything, run `node -v`; if it fails, tell the user to install Node **LTS** from nodejs.org, wait for them to finish, then continue. This is the one thing `npx` cannot self-provide — do not assume the desktop app bundles Node.
- Preview deployments are auth-walled — always deploy with `--prod` so the webhook is public
- `vercel login`'s authorization URL + device code may not print to the user on their own — the moment you start login, **copy the URL and device code into your reply, tell the user to open it and confirm, then wait**. Never run login silently; the user cannot guess where to authorize (observed 2026-06-15 fresh-run: setup stalled because the URL was never shown)
- Storage: Neon via the official agent-optimized marketplace CLI (ref: vercel.com/docs/cli/integration). After `vercel login`, run **`vercel integration accept-terms neon`** (one interactive human confirm; if it returns a `verification_uri`/device step, surface it to the user like the login link and wait), then **`vercel integration add neon --environment production`**. This provisions a free Postgres DB **under the user's own account** and, post-provision, auto-connects it to the linked project and injects `POSTGRES_URL` (it runs `vercel env pull` for you). `lib/redis.js` reads `POSTGRES_URL` — no code change. If terms are already accepted on the account, `add` alone suffices. Do NOT use Upstash — its Vercel integration has no free tier.
- Webhook: after deploy, register it by POSTing to `${BOT_URL}/api/setup` with the `Authorization: Bearer $SYNC_SECRET` header (the endpoint self-registers LINE's webhook using the channel token + platform host env — pass the secret in the header, never in the URL). The LINE **Use webhook** toggle itself is not API-settable → tell the user to switch it on once in the Messaging API page (the only LINE-side click they cannot avoid)
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

When the user says `進度` / `地圖` / `我在哪` / `闖關` / `跑到哪` / `progress`, run `bash scripts/progress.sh` and show its output as-is. It's a read-only detector — it shows which checkpoint they're on, which LINE keys are still missing (and where to get them), and the concrete next step. Don't paraphrase; the map IS the answer.

## Safety

- Keep all secrets in `.env`
- Do not commit `.env`, `logs/`, or downloaded messages
- Do not expose LINE access tokens or user IDs in chat output
- Group messages returned by the API are processed by the Codex model and are not an offline local-only workflow
- Do not deploy, edit code, or clear remote messages unless the user's request requires it
- When using the direct HTTP fallback, clear remote messages only after the response has been received successfully

## Customization

When the user changes the summary format or filtering rules, update this file or `config.json` so the behavior persists across new Codex sessions
