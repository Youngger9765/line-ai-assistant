import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// 整合 QA：真的算 LINE 簽章 → webhook 存訊息 → messages 讀回 → health 計數
// 不需要外部服務：用「攔截 fetch 的記憶體 Upstash」（@upstash/redis 走 REST /pipeline）
// 也攔 api.line.me（回假 profile/summary），讓 webhook 拿得到發言者/群組名

const SECRET = 'test-channel-secret';
const SYNC = 'test-sync-secret';

process.env.LINE_CHANNEL_SECRET = SECRET;
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
process.env.SYNC_SECRET = SYNC;
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

const store = new Map();
function resp(json) {
  return { ok: true, status: 200, headers: { get: () => '' }, json: async () => json, text: async () => JSON.stringify(json) };
}
function execCmd(cmd) {
  const [op, ...args] = cmd;
  const c = String(op).toLowerCase();
  if (c === 'set') { store.set(args[0], args[1]); return 'OK'; }
  if (c === 'get') { return store.has(args[0]) ? store.get(args[0]) : null; }
  if (c === 'del') { return store.delete(args[0]) ? 1 : 0; }
  if (c === 'scan') {
    const mi = args.findIndex((a) => String(a).toLowerCase() === 'match');
    const pattern = mi >= 0 ? String(args[mi + 1]) : '*';
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return ['0', [...store.keys()].filter((k) => re.test(k))];
  }
  return null;
}
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.line.me')) return resp({ displayName: '小明', groupName: '測試群' });
  const parsed = JSON.parse(opts.body);
  // @upstash/redis：pipeline 送 [["set",...],...]（陣列的陣列）；單命令送 ["scan",...]
  if (Array.isArray(parsed[0])) return resp(parsed.map((cmd) => ({ result: execCmd(cmd) })));
  return resp({ result: execCmd(parsed) });
};

// @line/bot-sdk 用 axios（非 global fetch），stub 掉發言者/群組名查詢
const { Client } = await import('@line/bot-sdk');
Client.prototype.getGroupMemberProfile = async () => ({ displayName: '小明' });
Client.prototype.getGroupSummary = async () => ({ groupName: '測試群' });

// 動態載入 handler（env + fetch 都設好之後）
const webhook = (await import('../api/webhook.js')).default;
const messages = (await import('../api/messages.js')).default;
const health = (await import('../api/health.js')).default;

function signedReq(bodyObj) {
  const body = JSON.stringify(bodyObj);
  const sig = crypto.createHmac('SHA256', SECRET).update(body).digest('base64');
  const r = Readable.from([Buffer.from(body)]);
  r.method = 'POST';
  r.headers = { 'x-line-signature': sig };
  return r;
}
function mkRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('round-trip：webhook 存群組訊息 → messages 讀回 → health 計數', async () => {
  store.clear();

  // 1) LINE 送來一則群組文字訊息（簽章正確）
  const evt = {
    events: [{
      type: 'message', message: { type: 'text', text: '明天十點開會' },
      source: { type: 'group', groupId: 'G123', userId: 'U1' }, timestamp: 1000,
    }],
  };
  const wres = mkRes();
  await webhook(signedReq(evt), wres);
  assert.equal(wres.statusCode, 200);
  assert.ok([...store.keys()].some((k) => k.startsWith('msg:G123:')), '訊息應存進 store');

  // 2) Codex 用 SYNC_SECRET 讀回
  const mres = mkRes();
  await messages({ method: 'GET', headers: { authorization: `Bearer ${SYNC}` }, query: {} }, mres);
  assert.equal(mres.statusCode, 200);
  assert.equal(mres.body.totalMessages, 1);
  assert.equal(mres.body.totalGroups, 1);
  const g = mres.body.groups['G123'];
  assert.ok(g, '應有 G123 群組');
  assert.equal(g.messages[0].text, '明天十點開會');
  assert.equal(g.messages[0].userName, '小明'); // 從（假）LINE profile 拿到

  // 3) health 回報後端 + 群組數
  const hres = mkRes();
  await health({}, hres);
  assert.equal(hres.statusCode, 200);
  assert.equal(hres.body.store, 'upstash');
  assert.equal(hres.body.groups, 1);
});

test('webhook 拒絕錯誤簽章（401）', async () => {
  const body = JSON.stringify({ events: [] });
  const r = Readable.from([Buffer.from(body)]);
  r.method = 'POST';
  r.headers = { 'x-line-signature': 'wrong-signature' };
  const res = mkRes();
  await webhook(r, res);
  assert.equal(res.statusCode, 401);
});

test('messages 沒帶對 SYNC_SECRET → 401', async () => {
  const res = mkRes();
  await messages({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('?clear=true 讀完會清掉訊息（下次讀為 0）', async () => {
  store.clear();
  const evt = {
    events: [{ type: 'message', message: { type: 'text', text: 'x' }, source: { type: 'group', groupId: 'G9', userId: 'U9' }, timestamp: 5 }],
  };
  await webhook(signedReq(evt), mkRes());
  const r1 = mkRes();
  await messages({ method: 'GET', headers: { authorization: `Bearer ${SYNC}` }, query: { clear: 'true' } }, r1);
  assert.equal(r1.body.totalMessages, 1);
  const r2 = mkRes();
  await messages({ method: 'GET', headers: { authorization: `Bearer ${SYNC}` }, query: {} }, r2);
  assert.equal(r2.body.totalMessages, 0, '清除後應讀不到');
});
