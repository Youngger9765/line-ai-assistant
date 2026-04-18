import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { Client } from '@line/bot-sdk';

// LINE Webhook — 接收群組訊息，存入 Vercel KV（純收集，不做摘要）

export const config = { api: { bodyParser: false } };

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
      // 只處理群組文字訊息
      if (event.type !== 'message' || event.message.type !== 'text') continue;
      if (event.source.type !== 'group') continue;

      const { groupId } = event.source;
      const { timestamp } = event;

      // 拿發言者名稱（KV cache，同一個人只查一次 LINE API）
      const userId = event.source.userId || 'unknown';
      const userCacheKey = `user:${userId}`;
      let userName = await kv.get(userCacheKey);
      if (!userName) {
        try {
          const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
          const profile = await client.getGroupMemberProfile(groupId, userId);
          userName = profile.displayName;
          await kv.set(userCacheKey, userName);
        } catch {
          userName = userId;
        }
      }

      // 儲存訊息（不設過期，sync 讀完後用 ?clear=true 清除）
      const msgKey = `msg:${groupId}:${timestamp}`;
      await kv.set(msgKey, {
        text: event.message.text,
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
          const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
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
