# LINE AI Assistant

Read `CLAUDE.md` for the project workflow, but follow the Codex-specific rules below when they conflict with Claude-only features

## Setup

Treat `setup`, `設定`, `初始化`, `第一次`, and similar first-run requests as the same onboarding workflow. Goal: take a non-technical user from a fresh fork to a working sync. **Do the secret setup for them** — generate keys and write `.env` yourself so the user types as little as possible. No CLI install, no terminal expertise.

1. Do NOT install anything (no `gh`, no `vercel`, no `git`, no `npm`). Deployment happens on the Vercel website; this app only needs `.env` and network access
2. If `.env` does not exist, copy `.env.example` to `.env`
3. Generate a strong random `SYNC_SECRET` yourself (e.g. `openssl rand -hex 16`) and write it into `.env`. Do not make the user invent or type a password
4. Tell the user to open `.env`, copy the `SYNC_SECRET` value, and paste it into Vercel as the `SYNC_SECRET` environment variable when they deploy. Do not print the value in chat — have them copy it from their own file
5. The LINE keys (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`) are entered only in Vercel's website during deploy — never handle, request, or print them locally
6. After the user deploys, ask only for their Vercel URL, then write it to `BOT_URL` in `.env` (strip `https://` and any trailing slash)
7. Never print, quote, or echo any `.env` value back to the user or inside a command
8. Run one `sync` (see the Sync section) to verify the connection
9. On HTTP 401, the `SYNC_SECRET` does not match Vercel — tell the user to re-check that Vercel and `.env` hold the same value. On a connection error, confirm the Vercel deployment is live and `BOT_URL` is correct
10. Report success only after a real response: state the number of groups and messages received, with no secret shown

Do not claim setup is complete until a verification `sync` has actually returned data

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
