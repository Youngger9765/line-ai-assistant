import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGates, NEXT_STEPS, currentLevel } from '../scripts/quest.mjs';

// 回歸鎖：闖關地圖的關卡切法（2026-08-06 志光試講前的兩個真實缺陷）
//
//   ① gates 與 NEXT_STEPS 是兩個必須同步的陣列。動了 gates 卻漏改 NEXT_STEPS，
//      NEXT_STEPS[current] 會是 undefined —— 而且只在學員「攻頂那一刻」才炸，
//      講師本機通常早就通關、跑起來永遠看不到。
//
//   ② 部署與資料庫原本是兩關，但 Codex 一次跑完、投影片也是一個段落，
//      學員因此直接跳關，螢幕上的 LV 對不上投影幕高亮的 phase。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 全關卡未完成的初始狀態，測試各自打開需要的旗標 */
const NONE = {
  hasProj: false, hasKeys: false, deployed: false,
  neon: false, receiving: false, synced: false,
};
const ALL = {
  hasProj: true, hasKeys: true, deployed: true,
  neon: true, receiving: true, synced: true,
};

test('每一關都有對應的下一步，攻頂那一關也有', () => {
  const gates = buildGates(ALL);
  assert.equal(NEXT_STEPS.length, gates.length + 1,
    'NEXT_STEPS 要比關卡數多一個（最後一個是攻頂後的話）');
  for (let lvl = 0; lvl <= gates.length; lvl++) {
    assert.equal(typeof NEXT_STEPS[lvl], 'string', `LV.${lvl} 的下一步是 undefined`);
    assert.ok(NEXT_STEPS[lvl].length > 0, `LV.${lvl} 的下一步是空字串`);
  }
});

test('學員依序推進時，關卡編號一關一關往前', () => {
  const steps = [
    [{ ...NONE }, 0, '什麼都還沒做'],
    [{ ...NONE, hasProj: true }, 1, '打開了資料夾'],
    [{ ...NONE, hasProj: true, hasKeys: true }, 2, '拿到兩把鑰匙'],
    [{ ...NONE, hasProj: true, hasKeys: true, deployed: true, neon: true }, 3, '部署完成'],
    [{ ...NONE, hasProj: true, hasKeys: true, deployed: true, neon: true, receiving: true }, 4, '收到群訊息'],
    [ALL, 5, '跑完 sync'],
  ];
  for (const [state, expected, label] of steps) {
    assert.equal(currentLevel(buildGates(state)), expected, `${label} → 應該是 LV.${expected}`);
  }
});

test('部署與資料庫是同一關 — 只部署好、資料庫沒接上，不能算過', () => {
  const half = { ...NONE, hasProj: true, hasKeys: true, deployed: true, neon: false };
  const gates = buildGates(half);
  assert.equal(gates[2].done, false, 'bot 上線但資料庫沒接 → 第 3 關不該通過');
  assert.equal(currentLevel(gates), 2, '應該停在第 3 關（index 2），不能跳關');
});

test('關卡數與課堂投影片的 phase 標籤一一對應', () => {
  // 投影片在另一個 repo（line-ai-course，講師私有），CI 環境不一定有 —— 取不到就跳過，
  // 但只要本機有，就必須對得上：學員看到 LV.2，抬頭要能找到「2 兩把鑰匙」高亮。
  const slides = join(ROOT, '..', 'line-ai-course', 'classes', 'inclass-build-slides.html');
  let html;
  try {
    html = readFileSync(slides, 'utf8');
  } catch {
    return; // 學員端只有這個 repo，正常情況
  }
  const m = html.match(/const phaseNames = \[([^\]]+)\]/);
  assert.ok(m, '投影片找不到 phaseNames — 是不是改了變數名');
  const phases = m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  const gates = buildGates(ALL);

  assert.equal(phases.length, gates.length + 1,
    `投影片有 ${phases.length} 個 phase，地圖有 ${gates.length} 關（+城堡）— 對不上`);
  gates.forEach((g, i) => {
    assert.ok(phases[i].startsWith(String(i + 1)),
      `投影片第 ${i + 1} 個 phase「${phases[i]}」沒有以編號 ${i + 1} 開頭，學員無法跟 LV.${i + 1} 對照`);
  });
});
