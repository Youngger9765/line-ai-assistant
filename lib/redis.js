// 儲存層 — 自動偵測後端，對外都長一樣（kv.get / kv.set / kv.scan / kv.del）
//
//   優先 Supabase / Postgres（POSTGRES_URL）：Vercel Storage Marketplace 的免費選項，
//                                            不綁卡、不會出現 Pay As You Go 字眼。
//   否則 fallback Upstash（UPSTASH_REDIS_REST_URL）：舊版相容。
//
// webhook.js / messages.js / health.js 完全不用改 —— 它們只認 kv 這個介面。
import { Redis } from '@upstash/redis';

const PG_URL =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let kv;
let store; // 'supabase' | 'upstash' — 哪個後端被選中，給驗證用

if (PG_URL) {
  kv = makePostgresKv(PG_URL);
  store = 'supabase';
} else if (UPSTASH_URL && UPSTASH_TOKEN) {
  kv = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
  store = 'upstash';
} else {
  throw new Error(
    'No store configured: set POSTGRES_URL (Supabase) or UPSTASH_REDIS_REST_URL + TOKEN'
  );
}

export { kv, store };

// --- Supabase / Postgres backend，模擬 Upstash 的 kv 介面 ---
function makePostgresKv(connString) {
  let ready = null;

  // 懶載入 driver + 確保 kv_store 表存在（只在第一次用到時跑一次）
  async function sql() {
    if (!ready) {
      ready = (async () => {
        const postgres = (await import('postgres')).default;
        // Supabase transaction pooler（6543）走 pgbouncer → prepare:false；serverless → max:1
        const s = postgres(connString, { prepare: false, max: 1, idle_timeout: 20 });
        await s`CREATE TABLE IF NOT EXISTS kv_store (
          key text PRIMARY KEY,
          value jsonb,
          updated_at timestamptz DEFAULT now()
        )`;
        // 開 RLS：anon REST API 一律讀不到這張 buffer（直連 postgres role 不受 RLS 限制）
        await s`ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY`.catch(() => {});
        return s;
      })();
    }
    return ready;
  }

  return {
    // 回傳已解析的值（物件或字串），不存在回 null —— 對齊 @upstash/redis 的 get 行為
    async get(key) {
      const s = await sql();
      const rows = await s`SELECT value FROM kv_store WHERE key = ${key}`;
      return rows.length ? rows[0].value : null;
    },

    // 2-arg set（無 TTL，跟本專案用法一致）。物件/字串都存成 jsonb
    async set(key, value) {
      const s = await sql();
      await s`
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (${key}, ${s.json(value)}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${s.json(value)}, updated_at = now()
      `;
      return 'OK';
    },

    async del(key) {
      const s = await sql();
      await s`DELETE FROM kv_store WHERE key = ${key}`;
      return 1;
    },

    // 模擬 Upstash SCAN：把 glob（msg:* / group:*）轉成 SQL LIKE，一次回全部 key。
    // 回 ['0', keys] → caller 的 do/while(cursor!=='0') 跑一輪就結束（buffer 量小，OK）
    async scan(_cursor, opts = {}) {
      const s = await sql();
      const like = String(opts.match || '*').replace(/\*/g, '%');
      const rows = await s`SELECT key FROM kv_store WHERE key LIKE ${like}`;
      return ['0', rows.map((r) => r.key)];
    },
  };
}
