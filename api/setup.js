import crypto from 'crypto';

// 一鍵設定端點 — bot 用自己的 access token 把 LINE Webhook URL 指回自己
//
// 目的：省掉「到 LINE Developers Console 手動貼 webhook URL + 按 Verify」那一步。
// 用法（POST，secret 走 header，不進 URL）：
//   curl -X POST -H "Authorization: Bearer <SYNC_SECRET>" https://<你的專案>.vercel.app/api/setup
// deploy.sh 部署後會自動幫你打這個。
//
// 安全：
//   - 只收 Authorization: Bearer header（不接受 ?secret= query，避免 secret 進 URL / access log）
//   - webhook 目標網域只信平台注入的 env（VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL），
//     不接受 ?url= 或 Host header（否則有 SYNC_SECRET 的人能把 webhook 導去任意主機）
//   - 抓不到可信網域就 fail closed

const LINE_API = 'https://api.line.me/v2/bot/channel/webhook';

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed — 用 POST + Authorization: Bearer {SYNC_SECRET}',
    });
  }

  // --- 驗證 SYNC_SECRET（只走 header，constant-time 比對）---
  const secret = process.env.SYNC_SECRET;
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !provided || !timingSafeEqualStr(provided, secret)) {
    return res.status(401).json({ error: 'Unauthorized — 需要 Authorization: Bearer {SYNC_SECRET}' });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' });
  }

  // --- webhook 目標網域：只信平台注入的 env，抓不到就 fail closed ---
  const trustedHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!trustedHost) {
    return res.status(500).json({
      error: '抓不到可信網域，請設定 VERCEL_PROJECT_PRODUCTION_URL',
    });
  }
  const host = String(trustedHost).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const endpoint = `https://${host}/api/webhook`;

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1) 設定 webhook endpoint URL
    const setRes = await fetch(`${LINE_API}/endpoint`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ endpoint }),
    });
    if (!setRes.ok) {
      const detail = await setRes.text().catch(() => '');
      return res.status(502).json({ error: '設定 webhook 失敗', status: setRes.status, detail });
    }

    // 2) 觸發 LINE 端的 verify（等同 Console 按 Verify）
    let verify = null;
    try {
      const vr = await fetch(`${LINE_API}/test`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ endpoint }),
      });
      verify = await vr.json().catch(() => ({ statusCode: vr.status }));
    } catch (e) {
      verify = { error: e.message };
    }

    return res.status(200).json({
      ok: true,
      endpoint,
      verify,
      note: '若 verify 非 200，請確認 LINE Developers → Messaging API 的「Use webhook」已開啟',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
