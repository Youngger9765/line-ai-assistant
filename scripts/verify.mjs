#!/usr/bin/env node
// 技術層一鍵驗證（跨平台 Node 版）— node scripts/verify.mjs
// 涵蓋：Node → health(store=postgres) → messages API → .env → sync 腳本 → logs
// Windows / Mac / Linux 只要有 node 就能跑（取代舊的 bash verify.sh）
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
if (!existsSync(ENV_FILE)) {
  console.log('❌ 找不到 .env（還沒部署？先跟 Codex/Claude 說「部署」）');
  process.exit(1);
}
const env = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const filled = (v) => !!v && !/your_|xxx|placeholder/i.test(v);

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass++; };
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const warn = (m) => { console.log('  ⚠️  ' + m); pass++; };

async function getJson(url, headers) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    return await r.json();
  } finally { clearTimeout(to); }
}

console.log('🔍 驗證 LINE AI 助理（技術層）');
console.log('================================');

// 0 Node（跑得了這支就代表有 node）
console.log('\n0️⃣  Node（npx vercel 靠它）');
ok(`Node 已裝（${process.version}）`);

// 1 Health + store
console.log('\n1️⃣  Health Check');
if (filled(env.BOT_URL)) {
  try {
    const j = await getJson(`https://${env.BOT_URL}/api/health`);
    if (j.status === 'ok') {
      const g = j.groups ?? '?';
      if (j.store === 'postgres') ok(`服務正常，後端=postgres（Neon）✓，${g} 個群組`);
      else warn(`服務正常但後端=${j.store}（預期 postgres/Neon）— 確認是不是還在用舊 upstash，${g} 群`);
    } else bad(`health 回應非 ok：${JSON.stringify(j)}`);
  } catch (e) { bad(`連不上 https://${env.BOT_URL}/api/health（${e.message}）`); }
} else bad('BOT_URL 未設（還沒部署？）');

// 2 Messages API
console.log('\n2️⃣  Messages API（Bearer token）');
if (filled(env.BOT_URL) && filled(env.SYNC_SECRET)) {
  try {
    const j = await getJson(`https://${env.BOT_URL}/api/messages`, { Authorization: `Bearer ${env.SYNC_SECRET}` });
    if (typeof j.totalMessages !== 'undefined') ok(`API 正常，${j.totalMessages} 則待 sync 訊息`);
    else bad(`Messages API 異常（SYNC_SECRET 對不上？）：${JSON.stringify(j)}`);
  } catch (e) { bad(`Messages API 連不上（${e.message}）`); }
} else bad('BOT_URL / SYNC_SECRET 未齊');

// 3 .env 完整性（LINE_USER_ID 選用）
console.log('\n3️⃣  .env 完整性');
const miss = ['BOT_URL', 'SYNC_SECRET', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'].filter((k) => !filled(env[k]));
if (miss.length === 0) ok('必要變數都填好了（LINE_USER_ID 選用，只推送回 LINE 才需要）');
else bad('未填/placeholder：' + miss.join(' '));

// 4 sync 腳本
console.log('\n4️⃣  sync 腳本');
existsSync(join(ROOT, 'scripts', 'sync_line.py')) ? ok('scripts/sync_line.py 存在') : bad('sync_line.py 不見了');

// 5 logs/
console.log('\n5️⃣  logs/');
if (existsSync(join(ROOT, 'logs'))) ok('logs/ 存在');
else { console.log('  ℹ️  logs/ 還沒建立（第一次 sync 後自動建）'); pass++; }

console.log('\n================================');
console.log(`結果：${pass} 通過 / ${fail} 失敗`);
console.log(fail === 0
  ? '🎉 技術層全過！可以開始 sync 了（體驗層還要人走一遍，見講師驗證清單）'
  : '⚠️  請修好失敗的項目');
process.exit(fail === 0 ? 0 : 1);
