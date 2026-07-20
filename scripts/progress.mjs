#!/usr/bin/env node
// 課程闖關地圖（跨平台 Node 版）— 學員說「進度 / 地圖 / 我在哪 / 闖關」時 agent 跑 `node scripts/progress.mjs`
// 做兩件事：① 終端機印文字地圖 ② 產生 progress.html（純靜態、零 JS、零 LLM，只是把偵測結果畫出來）
// 唯讀（不改專案）；沒 .env、沒部署都能跑。Windows / Mac / Linux 只要有 node 就能用。
// 架構：所有「判斷」都在這支腳本（確定性偵測，非 LLM）；HTML 永遠是死的，agent 每次重跑才重寫。
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const HTML_OUT = join(ROOT, 'progress.html');

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

// gate.done = 偵測結果；t=標題(白話) s=副標(白話) reward=過這關能得到什麼(動機)
const gates = [
  { done: hasProj,   t: '環境準備',            s: '裝好工具 + 課程資料夾（Node 這些 app 會幫你）', reward: '準備好，可以開始建你的助理' },
  { done: hasKeys,   t: '拿到兩把 LINE 鑰匙',   s: '在 LINE 後台複製 Channel Secret + Access Token', reward: 'AI 拿到鑰匙，能用你的身分接 LINE' },
  { done: deployed,  t: '部署上線',            s: '讓你的 bot 有一個活著的網址（AI 全自動，你不用碰）', reward: '你的 bot 上雲、開始待命' },
  { done: neon,      t: '幫 bot 準備記憶',      s: '雲端資料庫（跟著點就好，你不用懂它叫什麼）', reward: 'bot 記得住群組訊息' },
  { done: receiving, t: '接通 LINE + 開始收訊息', s: '把 bot 邀進你的群，它開始默默收', reward: '群組訊息開始流進你的 bot' },
  { done: synced,    t: '第一次同步',          s: '讓 bot 讀群組、產出第一份摘要', reward: '看到 AI 幫你整理的第一份群組重點 🎉' },
];
// 闖關照順序：卡在第一個沒過的關；之前算過、之後鎖住（免疫舊殘留狀態）
let current = gates.findIndex((g) => !g.done);
if (current === -1) current = gates.length; // 全過 = 畢業關

const keys = [
  { has: filled(env.LINE_CHANNEL_SECRET),      name: 'LINE Channel Secret', hint: '去 LINE Developers → Basic settings 複製' },
  { has: filled(env.LINE_CHANNEL_ACCESS_TOKEN), name: 'LINE Access Token',   hint: '去 LINE Developers → Messaging API → Issue' },
  { has: filled(env.SYNC_SECRET),  name: '系統密鑰（自動）', hint: '部署時 AI 自動生，你不用管' },
  { has: filled(env.BOT_URL),      name: '你的 bot 網址（自動）', hint: '部署成功後自動填，你不用管' },
];

const nextSteps = [
  '在 ChatGPT 切到 Codex、把課程資料夾拖進來（或用對話框上方「選擇專案」開）',
  '去 LINE Developers 建你的官方帳號，拿 Channel Secret + Access Token（兩把鑰匙）',
  '跟 Codex 說「部署」→ 授權登入一次 → 貼上你的兩把鑰匙 → 它會自動幫你上線',
  '已上線但沒接到記憶 → 跟 Codex 說「重新部署」或「接資料庫」',
  '去 LINE 開「Use webhook」開關 + 把 bot 邀進你的群，發幾句話',
  '跟 Codex 說「sync」，看它把群訊息整理成重點',
  '🎉 都通了！跟 Codex 說人話改摘要格式 / 加功能，做出你自己的助理',
];

const VISION = '完成後：你的 LINE 群多一個 AI 助理，自動幫你整理對話、抓重點、列待辦';
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

// ============ ① 終端機文字地圖 ============
console.log('🗺️  你的 LINE AI 助理 — 闖關地圖');
console.log('════════════════════════════════════════');
console.log(`進度：${current} / ${gates.length} 關`);
gates.forEach((g, i) => {
  const icon = i < current ? '✅' : i === current ? '📍' : '🔒';
  console.log(`${icon} 關卡${i + 1}  ${g.t}${i === current ? '   ← 你在這裡' : ''}`);
});
console.log(current === gates.length ? '🎓 關卡7  客製化畢業（自由關）' : '🎓 關卡7  客製化畢業（先過前面）');
console.log('════════════════════════════════════════');
console.log('\n🔑 鑰匙盤點');
for (const k of keys) console.log(`  ${k.has ? '✅' : '⬜'} ${k.name}${k.has ? '' : ' ← ' + k.hint}`);
console.log('\n👉 下一步\n  ' + nextSteps[current]);

// ============ ② 產生 progress.html（純靜態、零 JS）============
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = Math.round((current / gates.length) * 100);

const gatesHtml = gates.map((g, i) => {
  const st = i < current ? 'done' : i === current ? 'cur' : 'lock';
  const icon = st === 'done' ? '✓' : st === 'cur' ? '★' : '🔒';
  const here = st === 'cur' ? '<span class="here">你在這裡</span>' : '';
  const reward = st === 'cur' ? `<div class="reward">🎁 過這關：${esc(g.reward)}</div>` : '';
  return `<div class="gate ${st}"><div class="rail"></div><div class="badge">${icon}</div>
    <div class="body"><div class="n">關卡 ${i + 1}</div><div class="t">${esc(g.t)}${here}</div>
    <div class="s">${esc(g.s)}</div>${reward}</div></div>`;
}).join('\n');
const gradSt = current === gates.length ? 'cur' : 'lock';
const gradHtml = `<div class="gate ${gradSt}"><div class="badge">🎓</div>
  <div class="body"><div class="n">關卡 7</div><div class="t">客製化畢業（自由關）${current === gates.length ? '<span class="here">你在這裡</span>' : ''}</div>
  <div class="s">改成你要的樣子：改摘要格式、加功能</div></div></div>`;

const keysHtml = keys.map((k) =>
  `<div class="key"><span class="ki">${k.has ? '✅' : '⬜'}</span>
   <span>${esc(k.name)}<span class="kh">${k.has ? '已有' : esc(k.hint)}</span></span></div>`).join('\n');

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="8">
<title>闖關地圖</title><style>
:root{--bg:#faf8f4;--card:#fff;--ink:#1f2328;--mut:#5b6068;--faint:#9aa0a8;--line:#e6e6e6;
--done:#2f9e57;--done-bg:#eaf7ef;--cur:#e8873a;--cur-bg:#fff3e8;--lock:#b9bdc4;--accent:#3b6fd4}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"PingFang TC","Noto Sans TC",system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.7;padding:40px 20px;font-size:17px}
.wrap{max-width:780px;margin:0 auto}
h1{font-size:31px;letter-spacing:.5px;margin-bottom:8px}
.vision{background:#eef3fb;border:1px solid #d6e2f5;border-radius:12px;padding:12px 16px;color:#2f4b7c;font-size:16px;margin:10px 0 20px}
.sub{color:var(--mut);font-size:15px;margin-bottom:8px}
.bar{height:14px;background:#ececec;border-radius:10px;overflow:hidden;margin:6px 0 30px}
.bar>i{display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#2f9e57,#4bbf74);border-radius:10px}
.track{position:relative;padding-left:8px}
.gate{position:relative;display:flex;gap:16px;align-items:flex-start;padding:14px 0}
.gate .rail{position:absolute;left:23px;top:46px;bottom:-14px;width:3px;background:var(--line)}
.badge{flex:0 0 46px;height:46px;width:46px;border-radius:50%;display:grid;place-items:center;font-size:22px;font-weight:700;z-index:1;border:3px solid var(--line);background:#fff;color:var(--faint)}
.gate.done .badge{background:var(--done-bg);border-color:var(--done);color:var(--done)}
.gate.cur .badge{background:var(--cur-bg);border-color:var(--cur);color:var(--cur);box-shadow:0 0 0 6px var(--cur-bg)}
.gate.lock .badge{opacity:.7}
.body{flex:1;padding-top:2px}.body .n{font-size:13px;color:var(--faint);letter-spacing:1px}
.body .t{font-size:20px;font-weight:600}.gate.lock .body .t{color:var(--lock);font-weight:500}
.body .s{font-size:16px;color:var(--mut)}
.gate.lock .body .s{color:var(--faint)}
.here{display:inline-block;margin-left:8px;background:var(--cur);color:#fff;font-size:13px;padding:2px 11px;border-radius:20px;vertical-align:middle;font-weight:600}
.reward{margin-top:8px;background:var(--cur-bg);border:1px dashed #f0c69c;border-radius:9px;padding:7px 12px;font-size:15px;color:#8a4b18;display:inline-block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:32px}
@media(max-width:580px){.grid{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.panel h2{font-size:15px;color:var(--mut);letter-spacing:1px;margin-bottom:12px;font-weight:600}
.key{display:flex;gap:10px;align-items:flex-start;padding:8px 0;font-size:16px}
.key .ki{flex:0 0 22px}.key .kh{color:var(--faint);font-size:14px;display:block}
.next{background:linear-gradient(135deg,#fff3e8,#fdeede);border:1px solid #f2d3b6}
.next .big{font-size:18px;font-weight:600;color:#8a4b18}
.foot{margin-top:28px;color:var(--faint);font-size:14px;text-align:center;line-height:1.8}
.foot code{background:#eee;padding:1px 7px;border-radius:5px;font-size:13.5px;color:var(--ink)}
</style></head><body><div class="wrap">
<h1>🗺️ 你的 LINE AI 助理 — 闖關地圖</h1>
<div class="vision">🎯 ${esc(VISION)}</div>
<p class="sub">進度 <b>${current} / ${gates.length}</b> 關　·　最後更新 ${esc(stamp)}（由 Codex 更新）</p>
<div class="bar"><i></i></div>
<div class="track">
${gatesHtml}
${gradHtml}
</div>
<div class="grid">
<div class="panel"><h2>🔑 鑰匙盤點</h2>${keysHtml}</div>
<div class="panel next"><h2>👉 下一步</h2><div class="big">${esc(nextSteps[current])}</div></div>
</div>
<p class="foot">這張圖只是「顯示」你目前的進度，<b>它本身不會思考、不會自己更新</b><br>
跟 Codex 說一聲 <code>進度</code>，它重新看你電腦的狀態後、這張圖才會變<br>
（頁面每 8 秒自動重整，Codex 一更新你就會看到）</p>
</div></body></html>`;

try {
  writeFileSync(HTML_OUT, html, 'utf8');
  console.log(`\n🗺️  視覺闖關地圖已更新 → 打開這個檔看：\n  ${HTML_OUT}`);
} catch (e) {
  console.log(`\n（產生 HTML 失敗：${e.message}，文字版在上面）`);
}
console.log('');
