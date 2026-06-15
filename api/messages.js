import { kv } from '../lib/redis.js';

// 訊息讀取端點 — 讓 Codex 從學員電腦抓取所有暫存訊息

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 簡易 Bearer token 驗證
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.SYNC_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized — 需要 Authorization: Bearer {SYNC_SECRET}' });
  }

  try {
    // 用 SCAN 讀取所有 msg:* 訊息
    const msgKeys = [];
    let cursor = 0;
    do {
      const [next, batch] = await kv.scan(cursor, { match: 'msg:*', count: 100 });
      cursor = next;
      msgKeys.push(...batch);
    } while (cursor !== 0);

    // 讀取所有訊息內容
    const messages = [];
    for (const key of msgKeys) {
      const msg = await kv.get(key);
      if (msg) messages.push({ ...msg, _key: key });
    }

    // 按群組分類
    const groups = {};
    for (const msg of messages) {
      if (!groups[msg.groupId]) {
        const groupInfo = await kv.get(`group:${msg.groupId}`);
        groups[msg.groupId] = {
          name: groupInfo?.name || msg.groupId,
          messages: [],
        };
      }
      groups[msg.groupId].messages.push({
        text: msg.text,
        timestamp: msg.timestamp,
        userId: msg.userId,
        userName: msg.userName,
      });
    }

    // 每個群組按時間排序
    for (const g of Object.values(groups)) {
      g.messages.sort((a, b) => a.timestamp - b.timestamp);
    }

    // 如果帶 ?clear=true，讀完後清除訊息
    if (req.query.clear === 'true') {
      for (const key of msgKeys) await kv.del(key);
    }

    return res.status(200).json({
      groups,
      totalMessages: messages.length,
      totalGroups: Object.keys(groups).length,
    });
  } catch (err) {
    console.error('讀取訊息失敗:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
