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
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).parent.parent / "scripts" / "sync_line.py"
sync_line = types.ModuleType("sync_line")
sync_line.__file__ = str(SOURCE)
exec(compile(SOURCE.read_text(), str(SOURCE), "exec"), sync_line.__dict__)
build_api_url = sync_line.build_api_url

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

GROUPS = {"G1": {"name": "Test", "messages": [{
    "timestamp": 1000, "userName": "Tester", "text": "Saved message",
}]}}


def run_clear_case(save_fails=False):
    calls = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        def fake_fetch(_url, _secret, clear=False):
            calls.append("clear" if clear else "read")
            if clear:
                assert (root / "G1" / "1970-01-01.md").exists()
                return {"totalMessages": 0, "totalGroups": 0, "groups": {}}
            return {"totalMessages": 1, "totalGroups": 1, "groups": GROUPS}

        def fail_save(_groups, _mapping):
            calls.append("save")
            raise OSError("disk full")

        real_save = sync_line.save_messages

        def traced_save(groups, mapping):
            calls.append("save")
            return real_save(groups, mapping)

        with patch.object(sync_line, "LOGS_DIR", root), \
             patch.object(sync_line, "MAPPING_FILE", root / "_mapping.md"), \
             patch.object(sync_line, "load_env"), \
             patch.object(sync_line, "fetch_messages", side_effect=fake_fetch), \
             patch.object(sync_line, "save_messages", side_effect=fail_save if save_fails else traced_save), \
             patch.dict(os.environ, {"BOT_URL": "https://bot.example", "SYNC_SECRET": "test123"}), \
             patch.object(sys, "argv", ["sync_line.py", "--clear"]):
            if save_fails:
                try:
                    sync_line.main()
                except OSError as error:
                    assert str(error) == "disk full"
                else:
                    raise AssertionError("save failure must propagate")
            else:
                sync_line.main()
                assert "Saved message" in (root / "G1" / "1970-01-01.md").read_text()
    return calls


assert run_clear_case() == ["read", "save", "clear"]
assert run_clear_case(save_fails=True) == ["read", "save"]
print("  [PASS] clear follows durable save; save failure never clears remote messages")
