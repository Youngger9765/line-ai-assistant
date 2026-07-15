import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/setup.js';

// 回歸鎖：/api/setup 的安全行為（來自 2026-07 安全複審的 3 個發現）
//   - secret 只走 Authorization header（不接受 ?secret= → 不進 URL/log）
//   - webhook 目標只信平台 env（不接受 ?url= 或 Host header → 防劫持）
//   - 抓不到可信 host 就 fail closed（不打 LINE）

function mkReq(over = {}) {
  return { method: 'POST', headers: {}, query: {}, ...over };
}
function mkRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let fetchCalls;
beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, text: async () => '', json: async () => ({}) };
  };
  process.env.SYNC_SECRET = 'right-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'my-bot.vercel.app';
  delete process.env.VERCEL_URL;
});

test('GET is rejected (405) — POST-only', async () => {
  const res = mkRes();
  await handler(mkReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(fetchCalls.length, 0);
});

test('POST without Authorization → 401', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: {} }), res);
  assert.equal(res.statusCode, 401);
});

test('POST with wrong bearer → 401', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: { authorization: 'Bearer wrong' } }), res);
  assert.equal(res.statusCode, 401);
});

test('secret via ?secret= query is NOT accepted (no secret-in-URL path)', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: {}, query: { secret: 'right-secret' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetchCalls.length, 0);
});

test('no trusted host env → 500 fail-closed, never calls LINE', async () => {
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  const res = mkRes();
  await handler(mkReq({ headers: { authorization: 'Bearer right-secret' } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(fetchCalls.length, 0);
});

test('happy path → 200, registers webhook to the trusted host', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: { authorization: 'Bearer right-secret' } }), res);
  assert.equal(res.statusCode, 200);
  const put = fetchCalls.find((c) => c.opts?.method === 'PUT');
  assert.ok(put, 'should PUT the webhook endpoint');
  assert.equal(JSON.parse(put.opts.body).endpoint, 'https://my-bot.vercel.app/api/webhook');
});

test('attacker ?url= and Host header are ignored (no webhook hijack)', async () => {
  const res = mkRes();
  await handler(
    mkReq({
      headers: { authorization: 'Bearer right-secret', host: 'evil.example.com' },
      query: { url: 'evil.example.com' },
    }),
    res
  );
  const put = fetchCalls.find((c) => c.opts?.method === 'PUT');
  assert.equal(JSON.parse(put.opts.body).endpoint, 'https://my-bot.vercel.app/api/webhook');
});
