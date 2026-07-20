#!/usr/bin/env node
// 課程闖關地圖（跨平台 Node 版）— 學員說「進度 / 地圖 / 我在哪 / 闖關」時 agent 跑 `node scripts/progress.mjs`
// ① 終端機印文字地圖 ② 產生 progress.html（瑪利歐風世界地圖，純靜態、零 JS、零 LLM）
// 唯讀；沒 .env、沒部署都能跑。Windows / Mac / Linux 只要有 node 就能用。
// 架構：所有「判斷」都在這支腳本（確定性偵測，非 LLM）；HTML 永遠是死的，agent 每次重跑才重寫。
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const HTML_OUT = join(ROOT, 'progress.html');

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

function hasLogs() {
  const d = join(ROOT, 'logs');
  if (!existsSync(d)) return false;
  try {
    const walk = (p) => readdirSync(p, { withFileTypes: true }).some((e) =>
      e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.md'));
    return walk(d);
  } catch { return false; }
}

let store = '', groups = 0, healthOk = false;
if (filled(env.BOT_URL)) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://${env.BOT_URL}/api/health`, { signal: ctrl.signal });
    clearTimeout(to);
    const j = await r.json();
    if (j.status === 'ok') { healthOk = true; store = j.store || ''; groups = j.groups || 0; }
  } catch { /* 連不上 = 還沒部署好 */ }
}

const hasProj = existsSync(join(ROOT, 'package.json'));
const hasKeys = filled(env.LINE_CHANNEL_SECRET) && filled(env.LINE_CHANNEL_ACCESS_TOKEN);
const deployed = filled(env.BOT_URL) && healthOk;
const neon = store === 'postgres';
const receiving = groups > 0;
const synced = hasLogs();

// 每一關 = 一道機關。pass=通關條件（對到真實可偵測訊號，非任意）｜gain=過關拿到的戰利品
const gates = [
  { done: hasProj,   t: '整裝出發',      s: '裝好工具 + 拿到課程資料夾（Node 這些 app 會幫你）',
    pass: '電腦有 Node + 已打開課程資料夾', gain: '🎒 冒險裝備' },
  { done: hasKeys,   t: '取得兩把鑰匙',  s: '在 LINE 後台複製 Channel Secret + Access Token',
    pass: '建好 LINE 官方帳號、兩把鑰匙都貼進來了', gain: '🔑 LINE 鑰匙 ×2' },
  { done: deployed,  t: '喚醒你的 bot',  s: '跟 Codex 說「部署」，它全自動幫你上線（你不用碰 Vercel）',
    pass: '部署跑完、bot 網址活著', gain: '🌐 bot 網址' },
  { done: neon,      t: '打造記憶寶庫',  s: '雲端資料庫（跟著點就好，你不用懂它叫什麼）',
    pass: '資料庫接上、bot 有地方記東西', gain: '💾 記憶水晶' },
  { done: receiving, t: '接通 LINE 大門', s: '把 bot 邀進你的群，它開始默默收訊息',
    pass: 'bot 進群、收到第一則群訊息', gain: '📨 訊息之流' },
  { done: synced,    t: '召喚第一份摘要', s: '跟 Codex 說「sync」，讓它讀群組、產出重點',
    pass: '成功 sync、產出第一份摘要', gain: '📋 智慧卷軸' },
];
let current = gates.findIndex((g) => !g.done);
if (current === -1) current = gates.length;

const nextSteps = [
  '在 ChatGPT 切到 Codex、把課程資料夾拖進來（或用對話框上方「選擇專案」開）',
  '去 LINE Developers 建你的官方帳號，拿 Channel Secret + Access Token（兩把鑰匙）',
  '跟 Codex 說「部署」→ 授權登入一次 → 貼上你的兩把鑰匙 → 它會自動幫你上線',
  '已上線但沒接到記憶 → 跟 Codex 說「重新部署」或「接資料庫」',
  '去 LINE 開「Use webhook」開關 + 把 bot 邀進你的群，發幾句話',
  '跟 Codex 說「sync」，看它把群訊息整理成重點',
  '🎉 攻頂了！跟 Codex 說人話改摘要格式 / 加功能，打造你自己的助理',
];
const VISION = '完成後：你的 LINE 群多一個 AI 助理，自動幫你整理對話、抓重點、列待辦';
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

// ============ ① 終端機文字地圖 ============
console.log('🏰 你的 LINE AI 助理城堡 — 闖關地圖');
console.log('════════════════════════════════════════');
console.log(`LV.${current}　距離城堡還有 ${Math.max(gates.length - current, 0)} 關（${current}/${gates.length} 通關）`);
gates.forEach((g, i) => {
  const icon = i < current ? '🚩' : i === current ? '🧙' : '🔒';
  console.log(`${icon} 關卡${i + 1}  ${g.t}${i === current ? '   ← 你在這裡' : ''}`);
});
console.log(current === gates.length ? '🏰 終點  抵達城堡！客製化你的助理' : '🏰 終點  城堡（攻頂 = 你的專屬助理）');
console.log('════════════════════════════════════════');
if (current < gates.length) {
  console.log(`\n🎯 這關怎樣算過：${gates[current].pass}`);
  console.log(`🎁 過了拿到：${gates[current].gain}`);
}
console.log('\n👉 下一步\n  ' + nextSteps[current]);

// ============ ② 產生 progress.html（瑪利歐風世界地圖，純靜態）============
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = Math.round((current / gates.length) * 100);
const left = Math.max(gates.length - current, 0);

const stationsHtml = gates.map((g, i) => {
  const st = i < current ? 'done' : i === current ? 'cur' : 'lock';
  const marker = st === 'done' ? '🚩' : st === 'cur' ? '🧙' : '🔒';
  const here = st === 'cur' ? '<span class="here">YOU</span>' : '';
  let extra = '';
  if (st === 'cur') {
    extra = `<div class="quest"><div class="q goal">🎯 怎樣算過：${esc(g.pass)}</div>`
          + `<div class="q loot">🎁 過了拿到：${esc(g.gain)}</div></div>`;
  } else if (st === 'done') {
    extra = `<div class="got">✅ 已通關　·　戰利品 ${esc(g.gain)}</div>`;
  }
  return `<div class="lvl ${st}"><div class="road"></div>
    <div class="node">${marker}</div>
    <div class="card"><div class="lv">LEVEL ${i + 1}</div>
    <div class="t">${esc(g.t)}${here}</div><div class="s">${esc(g.s)}</div>${extra}</div></div>`;
}).join('\n');

const castleSt = current === gates.length ? 'cur' : 'lock';
const castleHtml = `<div class="lvl castle ${castleSt}">
  <div class="node big">🏰</div>
  <div class="card"><div class="lv">FINAL</div>
  <div class="t">城堡：你的專屬 AI 助理${current === gates.length ? '<span class="here">CLEAR!</span>' : ''}</div>
  <div class="s">攻頂後自由客製：改摘要格式、加功能</div></div></div>`;

// 背包：每關的戰利品，已通關=亮、未到=暗
const bagHtml = gates.map((g, i) =>
  `<div class="item ${i < current ? 'got' : ''}"><div class="ic">${i < current ? g.gain.slice(0, 2) : '❔'}</div>
   <div class="nm">${i < current ? esc(g.gain.slice(2).trim()) : '？？？'}</div></div>`).join('\n');

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="8"><title>世界地圖</title><style>
:root{--ink:#efe7d2;--mut:#c7bd9e;--faint:#8f866c;--gold:#ffcf4d;--sky1:#3b7dd8;--sky2:#5aa0e0;
--done:#57c98a;--cur:#ffb24d;--lock:#6d6a5a;--panel:#2b2a3d;--panel2:#34324a;--line:#454363}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"PingFang TC","Noto Sans TC",system-ui,sans-serif;color:var(--ink);line-height:1.6;font-size:17px;
background:linear-gradient(180deg,#2a2940 0%,#3a3556 55%,#5a4a78 100%);min-height:100vh;padding:34px 18px}
.wrap{max-width:720px;margin:0 auto}
.hd{text-align:center;margin-bottom:14px}
.hd h1{font-size:27px;letter-spacing:1px;text-shadow:2px 2px 0 #1c1b2e}
.hd .vision{display:inline-block;margin-top:8px;background:#1f1e30;border:1px solid var(--line);border-radius:20px;padding:7px 16px;color:var(--gold);font-size:14.5px}
.xp{max-width:520px;margin:16px auto 6px;display:flex;align-items:center;gap:12px;color:var(--mut);font-size:14px}
.xp .lv{background:var(--gold);color:#3a2c00;font-weight:800;border-radius:8px;padding:3px 10px;font-size:15px}
.bar{flex:1;height:16px;background:#1d1c2c;border-radius:12px;overflow:hidden;border:2px solid #14131f}
.bar>i{display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,var(--gold),#ffe08a);border-radius:10px}
.meter{text-align:center;color:var(--mut);font-size:13.5px;margin-bottom:26px}

.map{position:relative;padding-left:4px}
.lvl{position:relative;display:flex;gap:16px;align-items:flex-start;padding:11px 0}
.lvl .road{position:absolute;left:27px;top:58px;bottom:-11px;width:5px;background:repeating-linear-gradient(180deg,#c9a24a 0 8px,transparent 8px 16px);opacity:.55}
.lvl:last-of-type .road{display:none}
.node{flex:0 0 56px;height:56px;width:56px;border-radius:14px;display:grid;place-items:center;font-size:28px;z-index:1;
background:#25243a;border:3px solid var(--line);box-shadow:0 3px 0 #16152260}
.lvl.done .node{background:#1c3a2b;border-color:var(--done)}
.lvl.cur .node{background:#4a2f10;border-color:var(--cur);box-shadow:0 0 0 6px #ffb24d33,0 4px 0 #16152260;transform:scale(1.06)}
.lvl.lock .node{opacity:.55;filter:grayscale(.5)}
.node.big{font-size:34px}
.lvl.castle.cur .node{background:#4a3a10;border-color:var(--gold);box-shadow:0 0 0 7px #ffcf4d40}
.card{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 16px}
.lvl.cur .card{background:var(--panel2);border-color:var(--cur)}
.lvl.lock .card{opacity:.72}
.lv{font-size:12px;color:var(--gold);letter-spacing:2px;font-weight:800}
.lvl.lock .lv{color:var(--faint)}
.t{font-size:20px;font-weight:700}.lvl.lock .t{color:var(--mut);font-weight:600}
.s{font-size:15.5px;color:var(--mut)}.lvl.lock .s{color:var(--faint)}
.here{display:inline-block;margin-left:8px;background:var(--cur);color:#3a2600;font-size:12px;padding:2px 10px;border-radius:6px;vertical-align:middle;font-weight:800;letter-spacing:1px}
.lvl.castle .here{background:var(--gold)}
.quest{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.q{border-radius:9px;padding:8px 12px;font-size:15px;font-weight:600}
.q.goal{background:#1f2e45;border:1px solid #3f6aa0;color:#bcd6f5}
.q.loot{background:#3a2f12;border:1px dashed var(--gold);color:#ffdf9a}
.got{margin-top:8px;color:var(--done);font-size:13.5px;font-weight:600}

.next{margin-top:26px;background:linear-gradient(135deg,#4a2f10,#5c3d15);border:2px solid var(--cur);border-radius:14px;padding:16px 18px}
.next .h{color:var(--cur);font-size:14px;font-weight:800;letter-spacing:1px;margin-bottom:5px}
.next .big{font-size:18px;font-weight:700;color:#ffe4b8}

.bag{margin-top:20px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.bag .h{color:var(--gold);font-size:14px;font-weight:800;letter-spacing:1px;margin-bottom:12px}
.slots{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:520px){.slots{grid-template-columns:repeat(2,1fr)}}
.item{background:#1f1e30;border:1px solid var(--line);border-radius:11px;padding:10px;text-align:center}
.item.got{background:#26243c;border-color:#5c5686}
.item .ic{font-size:24px;filter:grayscale(1);opacity:.35}
.item.got .ic{filter:none;opacity:1}
.item .nm{font-size:12.5px;color:var(--faint);margin-top:4px}
.item.got .nm{color:var(--ink)}
.foot{margin-top:24px;color:var(--faint);font-size:13px;text-align:center;line-height:1.8}
.foot code{background:#1f1e30;padding:2px 8px;border-radius:5px;font-size:12.5px;color:var(--gold)}
</style></head><body><div class="wrap">
<div class="hd"><h1>🏰 你的 LINE AI 助理城堡</h1>
<div class="vision">🎯 ${esc(VISION)}</div></div>
<div class="xp"><span class="lv">LV ${current}</span><div class="bar"><i></i></div><span>${current}/${gates.length}</span></div>
<div class="meter">🗺️ 距離城堡還有 ${left} 關　·　更新 ${esc(stamp)}（由 Codex 探勘）</div>
<div class="map">
${stationsHtml}
${castleHtml}
</div>
<div class="next"><div class="h">👉 你的下一步</div><div class="big">${esc(nextSteps[current])}</div></div>
<div class="bag"><div class="h">🎒 背包 · 已收集戰利品</div><div class="slots">${bagHtml}</div></div>
<p class="foot">這張世界地圖只是「顯示」你的進度，<b>它自己不會動</b><br>
跟 Codex 說一聲 <code>進度</code>，它重新探勘你電腦後、地圖才會更新<br>
（每 8 秒自動重整，Codex 一更新你就看到角色前進、寶物亮起）</p>
</div></body></html>`;

try {
  writeFileSync(HTML_OUT, html, 'utf8');
  console.log(`\n🗺️  世界地圖已更新 → 打開這個檔看：\n  ${HTML_OUT}`);
} catch (e) {
  console.log(`\n（產生 HTML 失敗：${e.message}，文字版在上面）`);
}
console.log('');
