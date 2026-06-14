# LINE AI Assistant

Read `CLAUDE.md` for the project workflow, but follow the Codex-specific rules below when they conflict with Claude-only features

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
