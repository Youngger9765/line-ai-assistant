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
const io = { store: [], line: [], pageSize: Infinity, scanError: false };
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
    if (io.scanError) throw new Error('store unavailable');
    const mi = args.findIndex((a) => String(a).toLowerCase() === 'match');
    const pattern = mi >= 0 ? String(args[mi + 1]) : '*';
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const keys = [...store.keys()].filter((k) => re.test(k));
    const start = Number(args[0]);
    const end = Math.min(start + io.pageSize, keys.length);
    return [end < keys.length ? String(end) : '0', keys.slice(start, end)];
  }
  return null;
}
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.line.me')) { io.line.push(u); return resp({ displayName: '小明', groupName: '測試群' }); }
  const parsed = JSON.parse(opts.body);
  io.store.push(parsed);
  // @upstash/redis：pipeline 送 [["set",...],...]（陣列的陣列）；單命令送 ["scan",...]
  if (Array.isArray(parsed[0])) return resp(parsed.map((cmd) => ({ result: execCmd(cmd) })));
  return resp({ result: execCmd(parsed) });
};

// @line/bot-sdk 用 axios（非 global fetch），stub 掉發言者/群組名查詢
const { Client } = await import('@line/bot-sdk');
Client.prototype.getGroupMemberProfile = async (...args) => { io.line.push(['profile', ...args]); return { displayName: '小明' }; };
Client.prototype.getGroupSummary = async (...args) => { io.line.push(['summary', ...args]); return { groupName: '測試群' }; };
Client.prototype.getMessageContent = async (...args) => { io.line.push(['content', ...args]); throw new Error('LINE content unavailable'); };

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

function event(groupId, userId, timestamp, text = 'hello') {
  return { type: 'message', message: { type: 'text', text }, source: { type: 'group', groupId, userId }, timestamp };
}

function reset() {
  store.clear();
  io.store.length = 0;
  io.line.length = 0;
  io.pageSize = Infinity;
  io.scanError = false;
}

test('round-trip：webhook 存群組訊息 → messages 讀回 → health 計數', async () => {
  reset();

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
  reset();
  const body = JSON.stringify({ events: [] });
  const r = Readable.from([Buffer.from(body)]);
  r.method = 'POST';
  r.headers = { 'x-line-signature': 'wrong-signature' };
  const res = mkRes();
  await webhook(r, res);
  assert.equal(res.statusCode, 401);
  assert.equal(io.store.length, 0);
  assert.equal(io.line.length, 0);
});

test('webhook 無簽章或竄改內容時不寫 storage、不呼叫 LINE', async () => {
  for (const signature of [undefined, 'tampered']) {
    reset();
    const req = signedReq({ events: [event('G1', 'U1', 1)] });
    if (signature === undefined) delete req.headers['x-line-signature'];
    else req.headers['x-line-signature'] = signature;
    const res = mkRes();
    await webhook(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(io.store.length, 0);
    assert.equal(io.line.length, 0);
  }
});

test('webhook skips non-group and unsupported events, then reuses cached names', async () => {
  reset();
  const ignored = [
    { ...event('G1', 'U1', 1), type: 'follow' },
    { ...event('G1', 'U1', 2), source: { type: 'user', userId: 'U1' } },
    { ...event('G1', 'U1', 3), message: { type: 'sticker', id: 'S1' } },
  ];
  const first = mkRes();
  await webhook(signedReq({ events: ignored }), first);
  assert.equal(first.statusCode, 200);
  assert.equal(io.store.length, 0);
  assert.equal(io.line.length, 0);

  await webhook(signedReq({ events: [event('G1', 'U1', 4), event('G1', 'U1', 5)] }), mkRes());
  assert.equal(io.line.filter((x) => x[0] === 'profile').length, 1);
  assert.equal(io.line.filter((x) => x[0] === 'summary').length, 1);
  assert.equal([...store.keys()].filter((key) => key.startsWith('msg:')).length, 2);
});

test('webhook keeps media metadata when LINE content download fails', async () => {
  reset();
  const media = { ...event('G1', 'U1', 6), message: { type: 'file', id: 'M6', fileName: 'report.pdf' } };
  const res = mkRes();
  await webhook(signedReq({ events: [media] }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(io.line.filter((x) => x[0] === 'content').length, 1);
  assert.equal(store.has('msg:G1:6'), true);
  const saved = JSON.parse(store.get('msg:G1:6'));
  assert.equal(saved.type, 'file');
  assert.equal(saved.mediaUrl, null);
});

test('messages 沒帶對 SYNC_SECRET → 401', async () => {
  reset();
  const res = mkRes();
  await messages({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(io.store.length, 0);
});

test('messages 未授權讀取及 clear 都不碰 storage', async () => {
  for (const authorization of [undefined, 'Bearer wrong']) {
    reset();
    const res = mkRes();
    await messages({ method: 'GET', headers: { authorization }, query: { clear: 'true' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(io.store.length, 0);
  }
});

test('messages scans all pages, sorts each group, and retains data for clear=false', async () => {
  reset();
  io.pageSize = 1;
  store.set('group:G1', JSON.stringify({ name: 'One' }));
  store.set('group:G2', JSON.stringify({ name: 'Two' }));
  for (const [groupId, timestamp] of [['G1', 30], ['G2', 20], ['G1', 10]]) {
    store.set(`msg:${groupId}:${timestamp}`, JSON.stringify({ ...event(groupId, 'U1', timestamp).source, groupId, timestamp, text: String(timestamp), userName: '小明' }));
  }
  const res = mkRes();
  await messages({ method: 'GET', headers: { authorization: `Bearer ${SYNC}` }, query: { clear: 'false' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalMessages, 3, JSON.stringify(io.store));
  assert.equal(res.body.totalGroups, 2);
  assert.deepEqual(res.body.groups.G1.messages.map((m) => m.timestamp), [10, 30]);
  assert.equal(res.body.groups.G2.name, 'Two');
  assert.equal([...store.keys()].filter((key) => key.startsWith('msg:')).length, 3);
  assert.ok(io.store.filter((cmd) => cmd[0] === 'scan').length >= 3);
});

test('messages returns 500 when storage scan fails', async () => {
  reset();
  io.scanError = true;
  const res = mkRes();
  await messages({ method: 'GET', headers: { authorization: `Bearer ${SYNC}` }, query: { clear: 'true' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'store unavailable');
  io.scanError = false;
});

test('?clear=true 讀完會清掉訊息（下次讀為 0）', async () => {
  reset();
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

test('health counts group keys across scan pages and handles storage failure', async () => {
  reset();
  io.pageSize = 1;
  store.set('group:G1', { name: 'One' });
  store.set('group:G2', { name: 'Two' });
  store.set('msg:G1:1', { text: 'ignored' });
  const good = mkRes();
  await health({}, good);
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.groups, 2);
  io.scanError = true;
  const bad = mkRes();
  await health({}, bad);
  assert.equal(bad.statusCode, 503);
  assert.equal(bad.body.status, 'error');
  io.scanError = false;
});
