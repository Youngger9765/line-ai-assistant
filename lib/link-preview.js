// 範本 5（學習筆記）用：文字訊息含網址時，收訊當下抓該頁的標題/描述做預覽。
// 只取公開頁的 <title> 與 og:description／meta description，不跟隨登入、不存全文。
// 3 秒逾時、任何失敗一律回 null（呼叫端不擋收集，見 lib/message-record.js）。

const FETCH_TIMEOUT_MS = 3000;
const MAX_DESC_LEN = 300;

function getAttr(tag, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 從 HTML 字串抽 <title> 與 og:description／meta description
export function parseLinkMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

  let ogDesc = null;
  let metaDesc = null;
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = getAttr(tag, 'property');
    const name = getAttr(tag, 'name');
    const content = getAttr(tag, 'content');
    if (!content) continue;
    if (property && property.toLowerCase() === 'og:description') ogDesc = content;
    if (name && name.toLowerCase() === 'description') metaDesc = content;
  }
  const desc = decodeEntities(ogDesc || metaDesc || null);

  return {
    title: title || null,
    desc: desc ? desc.slice(0, MAX_DESC_LEN) : null,
  };
}

/**
 * 抓一個網址的連結預覽。只抓公開頁，逾時/失敗一律回 null（呼叫端不擋收集）。
 * @param {string} url
 * @returns {Promise<{title: string|null, desc: string|null, host: string}|null>}
 */
export async function fetchLinkPreview(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null; // 不是合法 URL
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LineAiAssistantBot/1.0)' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return { title: null, desc: null, host };

    const html = await res.text();
    const { title, desc } = parseLinkMeta(html);
    return { title, desc, host };
  } catch {
    return null; // 逾時／網路錯誤／被擋（Cloudflare／登入牆）
  } finally {
    clearTimeout(timer);
  }
}
