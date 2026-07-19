import { test } from 'node:test';
import assert from 'node:assert/strict';

// 回歸鎖：lib/redis.js 後端選擇（含斷點 A：沒設 DB env 會整個 app throw）

const STORE_ENVS = [
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
];
function clearStoreEnv() {
  for (const k of STORE_ENVS) delete process.env[k];
}

test('斷點 A：沒設任何 DB env → import 就 throw（部署缺 DB 會 DOA）', async () => {
  clearStoreEnv();
  await assert.rejects(() => import('../lib/redis.js?no-store'), /No store configured/);
});

test('設 Upstash env → store = upstash', async () => {
  clearStoreEnv();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
  const m = await import('../lib/redis.js?upstash-only');
  assert.equal(m.store, 'upstash');
});

test('設 Postgres env（Neon / Supabase）→ store = postgres', async () => {
  clearStoreEnv();
  process.env.POSTGRES_URL = 'postgres://localhost:5432/testdb';
  const m = await import('../lib/redis.js?pg-only');
  assert.equal(m.store, 'postgres');
});
