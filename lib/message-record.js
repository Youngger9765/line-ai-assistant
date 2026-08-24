// 純函式：把 LINE message event 轉成要存進 KV 的紀錄
// IO（下載媒體 / 上傳 Blob）以 deps 參數注入 → 可在 Node 20 直接單元測試（不需 module mock）

export const MEDIA_TYPES = ['image', 'video', 'audio', 'file'];

// 依訊息類型 + contentType 決定副檔名
export function pickExt(msgType, contentType, fileName) {
  if (msgType === 'file') return fileName?.split('.').pop() || 'bin';
  if (msgType === 'video') return 'mp4';
  if (msgType === 'audio') return 'm4a';
  return contentType?.split('/')[1] || 'jpg';
}

/**
 * @param event LINE message event（需 event.message.{type,id,text?,fileName?}）
 * @param base  { userId, userName, timestamp, groupId }
 * @param deps  { downloadContent(messageId)->{buffer,contentType}, putBlob(path,buffer,contentType)->url }
 * @returns 要存進 KV 的紀錄；若訊息類型不支援（貼圖/位置…）回 null（呼叫端跳過）
 */
export async function buildMessageRecord(event, base, deps) {
  const msgType = event.message.type;
  if (msgType !== 'text' && !MEDIA_TYPES.includes(msgType)) return null;

  let text = null, mediaUrl = null, contentType = null, fileName = null;

  if (msgType === 'text') {
    text = event.message.text;
  } else {
    // 媒體：下載內容 → 上傳 Blob 歸檔。失敗 fallback：mediaUrl=null，仍回 metadata（不擋收集）
    try {
      const dl = await deps.downloadContent(event.message.id);
      contentType = dl.contentType || 'application/octet-stream';
      const ext = pickExt(msgType, contentType, event.message.fileName);
      fileName = event.message.fileName || `${event.message.id}.${ext}`;
      const path = `line-media/${base.groupId}/${event.message.id}.${ext}`;
      mediaUrl = await deps.putBlob(path, dl.buffer, contentType);
    } catch (e) {
      // 上傳/下載失敗 → 留 metadata（type/fileName 若已取得），mediaUrl=null
    }
  }

  return { type: msgType, text, mediaUrl, contentType, fileName, ...base };
}
