import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { Client } from '@line/bot-sdk';
import { put } from '@vercel/blob';

// LINE Webhook — 接收群組訊息，存入 Vercel KV（純收集，不做摘要）
// 支援：text / image / video / audio / file（貼圖 sticker 過濾不存）

export const config = { api: { bodyParser: false } };

// 允許存入的訊息類型（sticker 不在此列）
const MEDIA_TYPES = new Set(['text', 'image', 'video', 'audio', 'file']);

// MIME → 副檔名 mapping（fallback .bin）
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/m4a': '.m4a',
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 驗證 LINE 簽章
function validateSignature(rawBody, signature) {
  const hash = crypto.createHmac('SHA256', process.env.LINE_CHANNEL_SECRET).update(rawBody).digest('base64');
  return hash === signature;
}

// 從 ReadableStream 收集成 Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// 取得副檔名（FILE 類型優先用原始檔名）
function getExtension(messageType, contentType, fileName) {
  if (messageType === 'file' && fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot !== -1 ? fileName.slice(dot) : '.bin';
  }
  if (messageType === 'video') return '.mp4';
  if (messageType === 'audio') return '.m4a';
  return MIME_TO_EXT[contentType] || '.bin';
}

// 下載媒體並上傳到 Vercel Blob，回傳 { url, contentType }
async function uploadMediaToBlob(client, messageId, messageType, groupId, fileName) {
  // getMessageContent 回傳 node.js stream（@line/bot-sdk v9 以上 ReadableStream）
  const stream = await client.getMessageContent(messageId);

  // 從 stream headers 拿 content-type（v9 SDK expose stream.headers）
  let contentType = stream.headers?.get?.('content-type') || stream.contentType || '';
  // 清除 charset 參數（e.g. image/jpeg; charset=utf-8 → image/jpeg）
  contentType = contentType.split(';')[0].trim();

  const buffer = await streamToBuffer(stream);
  const ext = getExtension(messageType, contentType, fileName);
  const blobPath = `line-media/${groupId}/${messageId}${ext}`;

  const blob = await put(blobPath, buffer, {
    access: 'public',
    contentType: contentType || 'application/octet-stream',
  });

  return { url: blob.url, contentType };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-line-signature'];
  if (!signature || !validateSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { events } = JSON.parse(rawBody.toString());
  if (!events || events.length === 0) return res.status(200).json({ message: 'OK' });

  for (const event of events) {
    try {
      // 只處理群組訊息，允許的媒體類型（sticker 等不在 MEDIA_TYPES 內，自動跳過）
      if (event.type !== 'message' || !MEDIA_TYPES.has(event.message.type)) continue;
      if (event.source.type !== 'group') continue;

      const { groupId } = event.source;
      const { timestamp } = event;
      const messageType = event.message.type;

      // 拿發言者名稱（KV cache，同一個人只查一次 LINE API）
      const userId = event.source.userId || 'unknown';
      const userCacheKey = `user:${userId}`;
      let userName = await kv.get(userCacheKey);
      const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
      if (!userName) {
        try {
          const profile = await client.getGroupMemberProfile(groupId, userId);
          userName = profile.displayName;
          await kv.set(userCacheKey, userName);
        } catch {
          userName = userId;
        }
      }

      // 媒體欄位
      let mediaUrl = null;
      let contentType = null;
      const fileName = event.message.fileName || null;
      const fileSize = event.message.fileSize || null;
      const duration = event.message.duration || null;

      // 非文字訊息 → 下載並上傳到 Vercel Blob
      if (messageType !== 'text') {
        try {
          const result = await uploadMediaToBlob(client, event.message.id, messageType, groupId, fileName);
          mediaUrl = result.url;
          contentType = result.contentType;
        } catch (err) {
          console.error('媒體上傳失敗:', err.message);
          // 上傳失敗仍存 metadata，但 mediaUrl 留 null
        }
      }

      // 儲存訊息 metadata（不設過期，sync 讀完後用 ?clear=true 清除）
      const msgKey = `msg:${groupId}:${timestamp}`;
      await kv.set(msgKey, {
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
      });

      // 記錄群組資訊（查 LINE API 拿群組名稱 + KV cache）
      const groupKey = `group:${groupId}`;
      const existing = await kv.get(groupKey);
      let groupName = existing?.name;
      if (!groupName || groupName === groupId) {
        try {
          const summary = await client.getGroupSummary(groupId);
          groupName = summary.groupName || groupId;
        } catch {
          groupName = groupId;
        }
      }
      await kv.set(groupKey, { groupId, name: groupName, lastMessage: Date.now() });
    } catch (err) {
      console.error('處理事件失敗:', err.message);
    }
  }

  return res.status(200).json({ message: 'OK' });
}
