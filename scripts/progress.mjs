#!/usr/bin/env node
// 課程闖關地圖（跨平台 Node 版）— 學員說「進度 / 地圖 / 我在哪 / 闖關」時 agent 跑 `node scripts/progress.mjs`
// 偵測「這台電腦現在跑到哪一關 + 還缺什麼鑰匙 + 下一步做什麼」
// 唯讀，不改任何東西；沒 .env、沒部署都能跑。Windows / Mac / Linux 只要有 node 就能用。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');

// ---- 讀 .env（若存在）----
const env = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
const filled = (v) => !!v && !/your_|xxx|placeholder/i.test(v);

// logs/ 底下有沒有 .md（sync 過的證據）
function hasLogs() {
  const d = join(ROOT, 'logs');
  if (!existsSync(d)) return false;
  try {
    const walk = (p) => readdirSync(p, { withFileTypes: true }).some((e) =>
      e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.md'));
    return walk(d);
  } catch { return false; }
}

// ---- health（有 BOT_URL 才打）----
let store = '', groups = 0, healthOk = false;
if (filled(env.BOT_URL)) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://${env.BOT_URL}/api/health`, { signal: ctrl.signal });
    clearTimeout(to);
    const j = await r.json();
    if (j.status === 'ok') { healthOk = true; store = j.store || ''; groups = j.groups || 0; }
  } catch { /* 連不上 = 還沒部署好，當沒過 */ }
}

const hasProj = existsSync(join(ROOT, 'package.json'));
const hasKeys = filled(env.LINE_CHANNEL_SECRET) && filled(env.LINE_CHANNEL_ACCESS_TOKEN);
const deployed = filled(env.BOT_URL) && healthOk;
const neon = store === 'postgres';
const receiving = groups > 0;
const synced = hasLogs();

const gates = [
  { done: hasProj,    label: '環境準備｜Node + 課程資料夾就位' },
  { done: hasKeys,    label: '拿到你的兩把 LINE 鑰匙' },
  { done: deployed,   label: '部署上線｜你的 bot 網址活著' },
  { done: neon,       label: '資料庫接好｜Neon (Postgres)' },
  { done: receiving,  label: 'LINE 接通 + 開始收群訊息' },
  { done: synced,     label: '第一次 sync｜看到群摘要' },
];
// 闖關照順序：卡在第一個沒過的關；它之前全算過、之後一律鎖住（免疫舊殘留狀態）
let current = gates.findIndex((g) => !g.done);
if (current === -1) current = gates.length;

console.log('🗺️  你的 LINE AI 助理 — 闖關地圖');
console.log('════════════════════════════════════════');
gates.forEach((g, i) => {
  const icon = i < current ? '✅' : i === current ? '📍' : '🔒';
  console.log(`${icon} 關卡${i + 1}  ${g.label}${i === current ? '   ← 你在這裡' : ''}`);
});
console.log(current === gates.length
  ? '🎓 關卡7  客製化畢業｜把助理改成你要的樣子（自由關）'
  : '🎓 關卡7  客製化畢業（先過前面幾關）');
console.log('════════════════════════════════════════');

console.log('\n🔑 鑰匙盤點');
console.log(filled(env.LINE_CHANNEL_SECRET)
  ? '  ✅ LINE Channel Secret（已有）'
  : '  ⬜ LINE Channel Secret ← 去 LINE Developers → Basic settings 複製');
console.log(filled(env.LINE_CHANNEL_ACCESS_TOKEN)
  ? '  ✅ LINE Access Token（已有）'
  : '  ⬜ LINE Access Token ← 去 LINE Developers → Messaging API → Issue');
console.log(filled(env.SYNC_SECRET)
  ? '  ✅ SYNC_SECRET（部署時自動生成）'
  : '  ⬜ SYNC_SECRET（部署時 AI 會自動生，你不用管）');
console.log(filled(env.BOT_URL)
  ? '  ✅ BOT_URL（已有，部署時自動填）'
  : '  ⬜ BOT_URL（部署成功後自動填，你不用管）');

console.log('\n👉 下一步');
const next = [
  '在 ChatGPT 切到 Codex、把課程資料夾拖進來（或用對話框上方「選擇專案」開）',
  '去 LINE Developers 建你的官方帳號，拿 Channel Secret + Access Token（兩把鑰匙）',
  '跟 Codex 說「部署」→ 授權登入一次 → 貼上你的兩把鑰匙 → 它會自動幫你上線',
  '已上線但沒接到 Neon → 跟 Codex 說「重新部署」或「接資料庫」',
  '去 LINE 開「Use webhook」開關 + 把 bot 邀進你的群，發幾句話',
  '跟 Codex 說「sync」，看它把群訊息整理成重點',
  '🎉 都通了！跟 Codex 說人話改摘要格式 / 加功能，做出你自己的助理',
];
console.log('  ' + next[current]);
console.log('');
