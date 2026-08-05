// 闖關地圖的關卡定義 —— 純資料 + 純函數，零 I/O。
//
// 為什麼獨立成一個檔：progress.mjs 一 import 就會打網路、寫 progress.html，
// 測試搆不到裡面的判斷。關卡怎麼切、學員現在第幾關、下一步該說什麼，
// 這三件事是這張地圖唯一有邏輯的地方，抽出來才鎖得住（見 test/quest.test.js）。
//
// ⚠️ 關卡名稱與數量要跟課堂投影片的 phase 標籤一致
//    （line-ai-course/classes/inclass-build-slides.html 的 phaseNames）。
//    學員打「進度」看到 LV.2，抬頭要能在投影幕上找到「2 兩把鑰匙」高亮。

/**
 * 依偵測到的環境狀態組出關卡表。
 * @param {object} s
 * @param {boolean} s.hasProj   打開了課程資料夾（package.json 在）
 * @param {boolean} s.hasKeys   .env 兩把 LINE 鑰匙都填了
 * @param {boolean} s.deployed  BOT_URL 填了且 /api/health 回 ok
 * @param {boolean} s.neon      health 的 store === 'postgres'
 * @param {boolean} s.receiving health 的 groups > 0
 * @param {boolean} s.synced    logs/ 底下有 .md
 */
export function buildGates({ hasProj, hasKeys, deployed, neon, receiving, synced }) {
  return [
    { done: hasProj, t: '整裝出發', s: '裝好工具 + 拿到課程資料夾（Node 這些 app 會幫你）',
      pass: '電腦有 Node + 已打開課程資料夾', gain: '🎒 冒險裝備' },
    { done: hasKeys, t: '取得兩把鑰匙', s: '在 LINE 後台複製 Channel Secret + Access Token',
      pass: '建好 LINE 官方帳號、兩把鑰匙都貼進來了', gain: '🔑 LINE 鑰匙 ×2' },
    // 部署 + 資料庫 = 同一關：投影片「Codex 開範本，先部署 Vercel + Neon」是一個段落，
    // Codex 也是一次跑完，拆兩關的話學員會直接跳關、對不上台上的進度
    { done: deployed && neon, t: '喚醒你的 bot',
      s: '跟 Codex 說「部署」，Vercel 和雲端資料庫一次幫你裝好（你都不用碰）',
      pass: 'bot 網址活著、資料庫也接上了', gain: '🌐 雲端基地' },
    { done: receiving, t: '接通 LINE 大門', s: '把網址貼回 LINE、再邀 bot 進你的群，它開始默默收訊息',
      pass: 'webhook 接上、bot 進群、收到第一則訊息', gain: '📨 訊息之流' },
    { done: synced, t: '召喚第一份摘要', s: '跟 Codex 說「sync」，讓它讀群組、產出重點',
      pass: '成功 sync、產出第一份摘要', gain: '📋 智慧卷軸' },
  ];
}

// 每一關卡住時要說的下一步。索引 = 目前關卡（0-based），
// 最後一個是攻頂後的話 → 長度必須是 關卡數 + 1，否則攻頂當下會拿到 undefined。
export const NEXT_STEPS = [
  '在 ChatGPT 切到 Codex、把課程資料夾拖進來（或用對話框上方「選擇專案」開）',
  '去 LINE Developers 建你的官方帳號，拿 Channel Secret + Access Token（兩把鑰匙）',
  '跟 Codex 說「部署」→ 授權登入一次 → 照著建雲端資料庫 → 它會自動幫你上線',
  '把 Codex 給你的網址貼回 LINE 的 Webhook URL、開「Use webhook」，再邀 bot 進群發幾句話',
  '跟 Codex 說「sync」，看它把群訊息整理成重點',
  '🎉 攻頂了！跟 Codex 說人話改摘要格式 / 加功能，打造你自己的助理',
];

export const VISION = '完成後：你的 LINE 群多一個 AI 助理，自動幫你整理對話、抓重點、列待辦';

/** 目前在第幾關（0-based）。全部通關時回傳 gates.length。 */
export function currentLevel(gates) {
  const i = gates.findIndex((g) => !g.done);
  return i === -1 ? gates.length : i;
}
