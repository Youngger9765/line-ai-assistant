import { kv } from '../lib/redis.js';

// 健康檢查端點 — 確認服務正常，回傳群組數量
export default async function handler(req, res) {
  try {
    const groups = [];
    let cursor = 0;
    do {
      const [next, batch] = await kv.scan(cursor, { match: 'group:*', count: 100 });
      cursor = next;
      groups.push(...batch);
    } while (String(cursor) !== '0');

    return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), groups: groups.length });
  } catch {
    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Redis not connected',
    });
  }
}
