// 一鍵設定端點 — bot 用自己的 access token 把 LINE Webhook URL 指回自己
//
// 目的：省掉「到 LINE Developers Console 手動貼 webhook URL + 按 Verify」那一步。
// 學員部署完，打開 https://<你的專案>.vercel.app/api/setup?secret=<SYNC_SECRET> 一次即可。
//
// 安全：用 SYNC_SECRET 擋（避免別人亂改你的 webhook）；只會動「這個 channel 自己」的 webhook。

const LINE_API = 'https://api.line.me/v2/bot/channel/webhook';

function unauthorized(res) {
  return res.status(401).json({
    error: 'Unauthorized — 需要 ?secret={SYNC_SECRET}（或 Authorization: Bearer {SYNC_SECRET}）',
  });
}

export default async function handler(req, res) {
  // --- 驗證 SYNC_SECRET ---
  const provided =
    req.query.secret || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.SYNC_SECRET || provided !== process.env.SYNC_SECRET) {
    return unauthorized(res);
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' });
  }

  // --- 決定 webhook URL：優先 production 網域，可用 ?url= 覆蓋 ---
  const rawHost =
    req.query.url ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    req.headers.host;
  if (!rawHost) {
    return res.status(400).json({ error: '抓不到網域，請帶 ?url=你的專案.vercel.app' });
  }
  const host = String(rawHost).replace(/^https?:\/\//, '').replace(/\/+$/, '');
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
