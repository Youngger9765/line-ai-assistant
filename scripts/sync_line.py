#!/usr/bin/env python3
"""
Sync LINE — 從 Vercel KV 抓取訊息，存到本地 logs/

用法：
  python3 scripts/sync_line.py              # 抓取 + 存檔
  python3 scripts/sync_line.py --clear      # 抓取 + 存檔 + 清除 KV

讀取 .env 的變數：
  BOT_URL          你的 Vercel 網址
  SYNC_SECRET      你設的 SYNC_SECRET
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

TZ_TAIPEI = timezone(timedelta(hours=8))
PROJECT_ROOT = Path(__file__).parent.parent
LOGS_DIR = PROJECT_ROOT / "logs"
MAPPING_FILE = LOGS_DIR / "_mapping.md"


def load_env():
    """讀取 .env 檔案"""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        print("❌ 找不到 .env，請先複製 .env.example 成 .env 並填入你的值")
        sys.exit(1)
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())


def fetch_messages(bot_url, sync_secret, clear=False):
    """從 /api/messages 抓取訊息"""
    url = f"https://{bot_url}/api/messages"
    if clear:
        url += "?clear=true"

    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {sync_secret}",
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"❌ 抓取失敗: {e}")
        sys.exit(1)


def update_mapping(groups):
    """更新 logs/_mapping.md 群組對照表"""
    existing = {}
    if MAPPING_FILE.exists():
        for line in MAPPING_FILE.read_text().splitlines():
            if line.startswith("|") and not line.startswith("| Group") and not line.startswith("|---"):
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) == 2:
                    existing[parts[0]] = parts[1]

    new_groups = 0
    for group_id, info in groups.items():
        if group_id not in existing:
            existing[group_id] = info.get("name", group_id)
            new_groups += 1

    # 寫回
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 群組對照表\n",
        "| Group ID | 群組名稱 |",
        "|----------|---------|",
    ]
    for gid, name in sorted(existing.items()):
        lines.append(f"| {gid} | {name} |")

    MAPPING_FILE.write_text("\n".join(lines) + "\n")

    if new_groups:
        print(f"  📋 Mapping: {new_groups} 個新群組加入")

    return existing


def save_messages(groups, mapping):
    """存訊息到 logs/{groupId}/{date}.md"""
    now = datetime.now(TZ_TAIPEI)
    saved = 0

    for group_id, info in groups.items():
        messages = info.get("messages", [])
        if not messages:
            continue

        group_name = mapping.get(group_id, group_id)
        group_dir = LOGS_DIR / group_id
        group_dir.mkdir(parents=True, exist_ok=True)

        # 按日期分組
        by_date = {}
        for msg in messages:
            ts = msg.get("timestamp", 0)
            dt = datetime.fromtimestamp(ts / 1000, tz=TZ_TAIPEI)
            date_str = dt.strftime("%Y-%m-%d")
            by_date.setdefault(date_str, []).append((dt, msg))

        for date_str, day_msgs in sorted(by_date.items()):
            filepath = group_dir / f"{date_str}.md"

            if filepath.exists():
                # append
                content = filepath.read_text()
                new_lines = []
                for dt, msg in sorted(day_msgs, key=lambda x: x[0]):
                    time_str = dt.strftime("%H:%M")
                    new_lines.append(f"\n## {time_str} - {msg.get('userName', msg.get('userId', 'unknown'))}")
                    new_lines.append(f"> {msg.get('text', '')}\n")
                filepath.write_text(content.rstrip() + "\n" + "\n".join(new_lines) + "\n")
            else:
                # 新檔
                lines = [f"# {group_name} — {date_str}\n"]
                for dt, msg in sorted(day_msgs, key=lambda x: x[0]):
                    time_str = dt.strftime("%H:%M")
                    lines.append(f"## {time_str} - {msg.get('userName', msg.get('userId', 'unknown'))}")
                    lines.append(f"> {msg.get('text', '')}\n")
                filepath.write_text("\n".join(lines) + "\n")

            saved += len(day_msgs)

    return saved


def main():
    load_env()

    bot_url = os.environ.get("BOT_URL", "")
    sync_secret = os.environ.get("SYNC_SECRET", "")

    if not bot_url or not sync_secret:
        print("❌ .env 裡缺少 BOT_URL 或 SYNC_SECRET")
        sys.exit(1)

    clear = "--clear" in sys.argv

    print(f"🔄 Sync LINE — {datetime.now(TZ_TAIPEI).strftime('%Y-%m-%d %H:%M')}")

    # 1. 抓取
    print(f"  📡 抓取 {bot_url}...")
    data = fetch_messages(bot_url, sync_secret, clear=False)

    total_msgs = data.get("totalMessages", 0)
    total_groups = data.get("totalGroups", 0)
    groups = data.get("groups", {})

    print(f"  📊 {total_groups} 群組, {total_msgs} 則訊息")

    if total_msgs == 0:
        print("  ✅ 沒有新訊息")
        return

    # 2. 更新 mapping
    mapping = update_mapping(groups)

    # 3. 存檔
    saved = save_messages(groups, mapping)
    print(f"  💾 存了 {saved} 則訊息到 logs/")

    # 4. 清除 KV（存檔成功後才清）
    if clear:
        fetch_messages(bot_url, sync_secret, clear=True)
        print("  🗑️ KV 已清除")

    print(f"  ✅ 完成")


if __name__ == "__main__":
    main()
