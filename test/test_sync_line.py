#!/usr/bin/env python3
"""Regression test for sync_line.build_api_url — BOT_URL scheme handling.

Locks the 2026-07-22 bug: Vercel CLI writes BOT_URL WITH a scheme
(https://xxx.vercel.app), but the sync script prepended `https://` again →
`https://https://xxx.vercel.app/api/messages` → urllib did DNS on "https" and
every student's `sync` died at the final step (deploy + webhook looked fine).

Run:  python3 test/test_sync_line.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from sync_line import build_api_url  # noqa: E402

EXPECTED = "https://my-line-bot.vercel.app/api/messages"
CASES = {
    "host-only (舊格式)": "my-line-bot.vercel.app",
    "https scheme (Vercel CLI 寫入格式)": "https://my-line-bot.vercel.app",
    "http scheme": "http://my-line-bot.vercel.app",
    "trailing slash": "https://my-line-bot.vercel.app/",
}

failed = 0
for label, bot_url in CASES.items():
    got = build_api_url(bot_url, "/api/messages")
    ok = got == EXPECTED
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {got}")
    if not ok:
        failed += 1

if failed:
    print(f"\n❌ {failed}/{len(CASES)} failed — BOT_URL scheme not normalized")
    sys.exit(1)
print(f"\n✅ {len(CASES)}/{len(CASES)} passed")
