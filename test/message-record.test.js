import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageRecord, pickExt, MEDIA_TYPES } from '../lib/message-record.js';

// 回歸鎖：媒體訊息支援（image/video/audio/file → 下載歸檔到 Blob）
//   image/file → 呼叫 putBlob、存 mediaUrl+metadata｜text → 向下相容｜sticker → 跳過(null)｜put 失敗 → fallback

const base = { userId: 'U1', userName: '測試員', timestamp: 123, groupId: 'G1' };

function fakeDeps() {
  const calls = { put: [] };
  return {
    calls,
    downloadContent: async () => ({ buffer: Buffer.from('BIN'), contentType: 'image/jpeg' }),
    putBlob: async (path, buf, ct) => { calls.put.push({ path, size: buf.length, ct }); return `https://blob.test/${path}`; },
  };
}

test('image → 呼叫 putBlob，帶回 mediaUrl + type，text=null', async () => {
  const d = fakeDeps();
  const r = await buildMessageRecord({ message: { type: 'image', id: 'M1' } }, base, d);
  assert.equal(d.calls.put.length, 1);
  assert.match(r.mediaUrl, /^https:\/\/blob\.test\/line-media\/G1\/M1\./);
  assert.equal(r.type, 'image');
  assert.equal(r.text, null);
  assert.equal(r.groupId, 'G1');
});

test('file → 用原始檔名副檔名歸檔，保留 fileName', async () => {
  const d = fakeDeps();
  const r = await buildMessageRecord({ message: { type: 'file', id: 'M2', fileName: '問卷.pdf' } }, base, d);
  assert.match(d.calls.put[0].path, /\.pdf$/);
  assert.equal(r.fileName, '問卷.pdf');
});

test('text → 不呼叫 putBlob，存 text，mediaUrl=null（向下相容）', async () => {
  const d = fakeDeps();
  const r = await buildMessageRecord({ message: { type: 'text', id: 'M3', text: '哈囉' } }, base, d);
  assert.equal(d.calls.put.length, 0);
  assert.equal(r.text, '哈囉');
  assert.equal(r.mediaUrl, null);
  assert.equal(r.type, 'text');
});

test('sticker → 回 null（跳過，不存 KV）', async () => {
  const d = fakeDeps();
  const r = await buildMessageRecord({ message: { type: 'sticker', id: 'M4' } }, base, d);
  assert.equal(r, null);
  assert.equal(d.calls.put.length, 0);
});

test('putBlob 失敗 → fallback：mediaUrl=null，仍回 metadata（不擋收集）', async () => {
  const d = fakeDeps();
  d.putBlob = async () => { throw new Error('blob down'); };
  const r = await buildMessageRecord({ message: { type: 'image', id: 'M5' } }, base, d);
  assert.equal(r.type, 'image');
  assert.equal(r.mediaUrl, null);
});

test('pickExt: video→mp4 / audio→m4a / file 用原名 / image 看 contentType', () => {
  assert.equal(pickExt('video', 'video/mp4'), 'mp4');
  assert.equal(pickExt('audio', 'audio/m4a'), 'm4a');
  assert.equal(pickExt('file', 'application/pdf', 'x.pdf'), 'pdf');
  assert.equal(pickExt('image', 'image/png'), 'png');
  assert.equal(pickExt('image', undefined), 'jpg');
});
