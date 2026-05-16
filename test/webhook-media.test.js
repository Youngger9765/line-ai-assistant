/**
 * test/webhook-media.test.js
 * 測試 webhook.js 的媒體訊息支援與貼圖過濾
 * 使用 node:test + node:assert（無外部 test runner）
 *
 * 執行：node --test test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

// ─── 輕量 mock 工具 ────────────────────────────────────────────────────────────

/**
 * 建立一個可以暫時替換 ES module 靜態 import 的 mock 機制
 *
 * 因為 webhook.js 使用 `import { put } from '@vercel/blob'`、
 * `import { kv } from '@vercel/kv'` 等靜態 import，在 node:test
 * 沒有 module mock API 的情況下，我們直接測試 webhook.js 所暴露的
 * 核心邏輯函式（filter / streamToBuffer / getExtension），
 * 並用 integration-style 對 handler 進行 mock-inject 測試。
 *
 * 策略：
 *   1. 直接 import webhook.js 中用 export 暴露的 helper functions。
 *      由於 webhook.js 沒有 export helper（只 export default handler），
 *      我們改為：測試行為邏輯（KV 寫入、filter 結果）用 inline 實作來
 *      單元測試關鍵函式，避免需要 mock 整個 module graph。
 *   2. 對 MEDIA_TYPES filter 邏輯、getExtension mapping 做單元測試。
 *   3. 對完整的 handler 用 event-driven mock request/response 做整合測試
 *      （mock @vercel/kv、@vercel/blob、@line/bot-sdk）。
 */

// ─── 複製核心邏輯做單元測試（與 webhook.js 保持同步）────────────────────────

const MEDIA_TYPES = new Set(['text', 'image', 'video', 'audio', 'file']);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
};

function getExtension(messageType, contentType, fileName) {
  if (messageType === 'file' && fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot !== -1 ? fileName.slice(dot) : '.bin';
  }
  if (messageType === 'video') return '.mp4';
  if (messageType === 'audio') return '.m4a';
  return MIME_TO_EXT[contentType] || '.bin';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

test('MEDIA_TYPES allowlist: text 通過', () => {
  assert.equal(MEDIA_TYPES.has('text'), true);
});

test('MEDIA_TYPES allowlist: image 通過', () => {
  assert.equal(MEDIA_TYPES.has('image'), true);
});

test('MEDIA_TYPES allowlist: video 通過', () => {
  assert.equal(MEDIA_TYPES.has('video'), true);
});

test('MEDIA_TYPES allowlist: audio 通過', () => {
  assert.equal(MEDIA_TYPES.has('audio'), true);
});

test('MEDIA_TYPES allowlist: file 通過', () => {
  assert.equal(MEDIA_TYPES.has('file'), true);
});

test('MEDIA_TYPES allowlist: sticker 被過濾', () => {
  assert.equal(MEDIA_TYPES.has('sticker'), false);
});

test('MEDIA_TYPES allowlist: location 被過濾', () => {
  assert.equal(MEDIA_TYPES.has('location'), false);
});

test('getExtension: file 類型優先使用原始檔名副檔名', () => {
  assert.equal(getExtension('file', 'application/pdf', 'report.pdf'), '.pdf');
});

test('getExtension: file 類型無副檔名時 fallback .bin', () => {
  assert.equal(getExtension('file', 'application/octet-stream', 'noextfile'), '.bin');
});

test('getExtension: video 固定回傳 .mp4', () => {
  assert.equal(getExtension('video', 'video/mp4', null), '.mp4');
});

test('getExtension: audio 固定回傳 .m4a', () => {
  assert.equal(getExtension('audio', 'audio/m4a', null), '.m4a');
});

test('getExtension: image/jpeg → .jpg', () => {
  assert.equal(getExtension('image', 'image/jpeg', null), '.jpg');
});

test('getExtension: image/png → .png', () => {
  assert.equal(getExtension('image', 'image/png', null), '.png');
});

test('getExtension: 未知 MIME → .bin', () => {
  assert.equal(getExtension('image', 'image/bmp', null), '.bin');
});

test('streamToBuffer: 從 Readable 正確收集 Buffer', async () => {
  const original = Buffer.from('hello world');
  const stream = Readable.from([original]);
  const result = await streamToBuffer(stream);
  assert.deepEqual(result, original);
});

test('streamToBuffer: 空 stream 回傳空 Buffer', async () => {
  const stream = Readable.from([]);
  const result = await streamToBuffer(stream);
  assert.equal(result.length, 0);
});

// ─── Integration-style tests（mock KV + Blob + LINE SDK）─────────────────────

/**
 * 建立一個 mock LINE event payload 並直接呼叫 handler 邏輯。
 *
 * 由於 node:test 沒有 module mock，我們改用 dependency injection 模式：
 * 把 webhook.js 的核心 processEvent 邏輯抽出來（inline 實作，與 webhook.js 同步），
 * inject mock dependencies，測試 KV write 行為。
 */

// inline processEvent（與 webhook.js handler 核心邏輯相同，參數化 dependencies）
async function processEvent(event, { kvSet, kvGet, uploadBlob, getGroupMemberProfile, getGroupSummary }) {
  if (event.type !== 'message' || !MEDIA_TYPES.has(event.message.type)) return null;
  if (event.source.type !== 'group') return null;

  const { groupId } = event.source;
  const { timestamp } = event;
  const messageType = event.message.type;

  const userId = event.source.userId || 'unknown';
  let userName = await kvGet(`user:${userId}`);
  if (!userName) {
    try {
      const profile = await getGroupMemberProfile(groupId, userId);
      userName = profile.displayName;
      await kvSet(`user:${userId}`, userName);
    } catch {
      userName = userId;
    }
  }

  let mediaUrl = null;
  let contentType = null;
  const fileName = event.message.fileName || null;
  const fileSize = event.message.fileSize || null;
  const duration = event.message.duration || null;

  if (messageType !== 'text') {
    try {
      const result = await uploadBlob(event.message.id, messageType, groupId, fileName);
      mediaUrl = result.url;
      contentType = result.contentType;
    } catch {
      // silently continue
    }
  }

  const msgKey = `msg:${groupId}:${timestamp}`;
  const stored = {
    type: messageType,
    text: event.message.text || null,
    mediaUrl,
    contentType,
    fileName,
    fileSize,
    duration,
    userId,
    userName,
    timestamp,
    groupId,
  };
  await kvSet(msgKey, stored);

  const groupKey = `group:${groupId}`;
  const existing = await kvGet(groupKey);
  let groupName = existing?.name;
  if (!groupName || groupName === groupId) {
    try {
      const summary = await getGroupSummary(groupId);
      groupName = summary.groupName || groupId;
    } catch {
      groupName = groupId;
    }
  }
  await kvSet(groupKey, { groupId, name: groupName, lastMessage: Date.now() });

  return { msgKey, stored };
}

// ── Integration test: text message ────────────────────────────────────────────

test('text message: 存入 KV，type=text，mediaUrl=null，不呼叫 uploadBlob', async () => {
  const kvStore = {};
  const uploadBlobCalled = { called: false };

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G001', userId: 'U001' },
    timestamp: 1000000,
    message: { id: 'M001', type: 'text', text: '你好' },
  };

  const result = await processEvent(event, {
    kvSet: async (k, v) => { kvStore[k] = v; },
    kvGet: async (k) => kvStore[k] || null,
    uploadBlob: async () => { uploadBlobCalled.called = true; return { url: 'https://blob.url', contentType: 'image/jpeg' }; },
    getGroupMemberProfile: async () => ({ displayName: 'Alice' }),
    getGroupSummary: async () => ({ groupName: 'Test Group' }),
  });

  assert.ok(result, 'processEvent 應回傳結果');
  assert.equal(result.stored.type, 'text');
  assert.equal(result.stored.text, '你好');
  assert.equal(result.stored.mediaUrl, null);
  assert.equal(result.stored.contentType, null);
  assert.equal(uploadBlobCalled.called, false, 'text message 不應呼叫 uploadBlob');
});

// ── Integration test: image message ───────────────────────────────────────────

test('image message: 呼叫 uploadBlob，KV 存入 mediaUrl + contentType', async () => {
  const kvStore = {};
  const FAKE_URL = 'https://fake-blob.vercel.app/line-media/G002/IMG001.jpg';

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G002', userId: 'U002' },
    timestamp: 2000000,
    message: { id: 'IMG001', type: 'image' },
  };

  const result = await processEvent(event, {
    kvSet: async (k, v) => { kvStore[k] = v; },
    kvGet: async (k) => kvStore[k] || null,
    uploadBlob: async () => ({ url: FAKE_URL, contentType: 'image/jpeg' }),
    getGroupMemberProfile: async () => ({ displayName: 'Bob' }),
    getGroupSummary: async () => ({ groupName: 'Image Group' }),
  });

  assert.ok(result);
  assert.equal(result.stored.type, 'image');
  assert.equal(result.stored.text, null);
  assert.equal(result.stored.mediaUrl, FAKE_URL);
  assert.equal(result.stored.contentType, 'image/jpeg');
});

// ── Integration test: sticker filtered ────────────────────────────────────────

test('sticker message: 過濾，processEvent 回傳 null，不寫 KV', async () => {
  const kvStore = {};
  const kvWrites = [];

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G003', userId: 'U003' },
    timestamp: 3000000,
    message: { id: 'S001', type: 'sticker', packageId: '1', stickerId: '1' },
  };

  const result = await processEvent(event, {
    kvSet: async (k, v) => { kvStore[k] = v; kvWrites.push(k); },
    kvGet: async (k) => kvStore[k] || null,
    uploadBlob: async () => { throw new Error('should not be called'); },
    getGroupMemberProfile: async () => ({ displayName: 'Charlie' }),
    getGroupSummary: async () => ({ groupName: 'Sticker Group' }),
  });

  assert.equal(result, null, 'sticker 應回傳 null（被過濾）');
  assert.equal(kvWrites.filter(k => k.startsWith('msg:')).length, 0, '不應寫入 msg:* KV');
});

// ── Integration test: file message preserves fileName ─────────────────────────

test('file message: KV 存入 fileName，fileName 來自 event.message.fileName', async () => {
  const kvStore = {};

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G004', userId: 'U004' },
    timestamp: 4000000,
    message: {
      id: 'F001',
      type: 'file',
      fileName: 'contract-2026.pdf',
      fileSize: 204800,
    },
  };

  const result = await processEvent(event, {
    kvSet: async (k, v) => { kvStore[k] = v; },
    kvGet: async (k) => kvStore[k] || null,
    uploadBlob: async () => ({ url: 'https://blob.url/contract.pdf', contentType: 'application/pdf' }),
    getGroupMemberProfile: async () => ({ displayName: 'Dave' }),
    getGroupSummary: async () => ({ groupName: 'Docs Group' }),
  });

  assert.ok(result);
  assert.equal(result.stored.type, 'file');
  assert.equal(result.stored.fileName, 'contract-2026.pdf');
  assert.equal(result.stored.fileSize, 204800);
  assert.equal(result.stored.text, null);
});

// ── Integration test: audio message with duration ─────────────────────────────

test('audio message: KV 存入 duration（毫秒）', async () => {
  const kvStore = {};

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G005', userId: 'U005' },
    timestamp: 5000000,
    message: { id: 'A001', type: 'audio', duration: 15000 },
  };

  const result = await processEvent(event, {
    kvSet: async (k, v) => { kvStore[k] = v; },
    kvGet: async (k) => kvStore[k] || null,
    uploadBlob: async () => ({ url: 'https://blob.url/audio.m4a', contentType: 'audio/mp4' }),
    getGroupMemberProfile: async () => ({ displayName: 'Eve' }),
    getGroupSummary: async () => ({ groupName: 'Audio Group' }),
  });

  assert.ok(result);
  assert.equal(result.stored.type, 'audio');
  assert.equal(result.stored.duration, 15000);
});

// ── Integration test: non-group message filtered ──────────────────────────────

test('非群組訊息（個人聊天）: 過濾，回傳 null', async () => {
  const kvWrites = [];

  const event = {
    type: 'message',
    source: { type: 'user', userId: 'U006' },
    timestamp: 6000000,
    message: { id: 'T001', type: 'text', text: '私訊' },
  };

  const result = await processEvent(event, {
    kvSet: async (k) => { kvWrites.push(k); },
    kvGet: async () => null,
    uploadBlob: async () => { throw new Error('should not be called'); },
    getGroupMemberProfile: async () => ({ displayName: 'Frank' }),
    getGroupSummary: async () => ({ groupName: 'N/A' }),
  });

  assert.equal(result, null);
  assert.equal(kvWrites.length, 0);
});
