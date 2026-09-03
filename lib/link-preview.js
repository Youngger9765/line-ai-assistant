// 範本 5（學習筆記）用：文字訊息含網址時，收訊當下抓該頁的標題/描述做預覽。
// 只取公開頁的 <title> 與 og:description／meta description，不跟隨登入、不存全文。
// 3 秒逾時、任何失敗一律回 null（呼叫端不擋收集，見 lib/message-record.js）。
//
// ⚠️ 安全（2026-09-04 補，SSRF 修復）：這是 server-side fetch，url 來自「群裡任何人貼的文字」，
// 是教科書等級的 SSRF 攻擊面（打內網服務／打 cloud metadata 169.254.169.254／file:// 讀本機檔／
// 靠開放重導繞過檢查）。防線：只准 http/https、拒絕含 userinfo 的 URL、literal IP 與 DNS 解析出的
// 每一個位址都要過私網/保留位址黑名單、redirect 手動處理且每一跳重新檢查、body 只讀前 64KB、
// 輸出去 HTML tag／控制字元／截斷。
//
// dns 解析與 fetch 都可從 fetchLinkPreview 的第二參數注入（測試用，避免打真網路/真 DNS），
// 預設走 Node 內建的 dns.promises.lookup 與全域 fetch。

import dns from 'node:dns';
import net from 'node:net';

const FETCH_TIMEOUT_MS = 3000;
const MAX_TEXT_LEN = 300;
const MAX_BODY_BYTES = 64 * 1024; // 只讀前 64KB
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultLookup = (hostname, options) => dns.promises.lookup(hostname, options);

// ---------- 私網／保留位址檢查 ----------

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function cidrMatch(intIp, base, bits) {
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (intIp & mask) === (ipv4ToInt(base) & mask);
}

// RFC 1918/5735/6890 私網與保留範圍 + cloud metadata（169.254.169.254 落在 link-local）
const PRIVATE_V4_RANGES = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local，含 cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmark
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / broadcast
];

function isPrivateIPv4(ip) {
  const intIp = ipv4ToInt(ip);
  if (intIp === null) return true; // 解析不出來的一律當危險擋掉
  return PRIVATE_V4_RANGES.some(([base, bits]) => cidrMatch(intIp, base, bits));
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified

  // IPv4-mapped（::ffff:a.b.c.d）→ 拆出內層 IPv4 一起檢查
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  const firstHextet = parseInt(lower.split(':')[0] || '0', 16) || 0;
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local（含 fd00::/8）
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // 不是合法 IP 格式 → 當危險擋掉
}

// ---------- URL 安全檢查 ----------

// scheme／格式層：不需要 DNS 就能判斷的部分。回 URL 物件（安全）或 null（不安全/不合法）
function checkUrlSchemeAndFormat(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null; // 含 userinfo（http://user:pw@host）
  return parsed;
}

// hostname 層：literal IP 直接判；網域名要 DNS 解析「每一個」回來的位址都要安全才算安全
async function isHostnameSafe(hostname, lookup) {
  const bareHost = hostname.replace(/^\[|\]$/g, ''); // IPv6 literal 的中括號
  if (bareHost.toLowerCase() === 'localhost') return false;

  if (net.isIP(bareHost)) {
    return !isPrivateOrReservedIp(bareHost);
  }

  try {
    const result = await lookup(bareHost, { all: true, verbatim: true });
    const list = Array.isArray(result) ? result : [result];
    if (list.length === 0) return false;
    return list.every((r) => r && r.address && !isPrivateOrReservedIp(r.address));
  } catch {
    return false; // DNS 查不到／逾時 → 一律當不安全，不放行
  }
}

// 完整安全檢查：合法 http/https、無 userinfo、位址不是私網/保留。安全回 URL 物件，否則 null
async function checkUrlSafe(rawUrl, lookup) {
  const parsed = checkUrlSchemeAndFormat(rawUrl);
  if (!parsed) return null;
  const hostnameSafe = await isHostnameSafe(parsed.hostname, lookup);
  return hostnameSafe ? parsed : null;
}

// ---------- HTML 解析與輸出清洗 ----------

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

function stripTags(str) {
  if (!str) return str;
  return str.replace(/<[^>]*>/g, '');
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function stripControlChars(str) {
  if (!str) return str;
  return str.replace(CONTROL_CHARS_RE, '');
}

function sanitize(str, maxLen = MAX_TEXT_LEN) {
  if (!str) return null;
  const cleaned = stripControlChars(stripTags(decodeEntities(str))).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLen) : null;
}

// 從 HTML 字串抽 <title> 與 og:description／meta description（未清洗，交給 sanitize 處理）
export function parseLinkMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

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

  return { title, desc: ogDesc || metaDesc || null };
}

// 只讀前 maxBytes；有 streaming reader 就邊讀邊停，沒有（測試用的簡易 mock）就退回 text() 後截斷
async function readBoundedText(res, maxBytes) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    try {
      while (received < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      try {
        reader.cancel();
      } catch {
        // 忽略取消失敗
      }
    }
    return text;
  }
  const full = await res.text();
  return full.slice(0, maxBytes);
}

async function safeFetch(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'manual', // 手動處理重導，每一跳都要重新過安全檢查
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LineAiAssistantBot/1.0)' },
    });
  } catch {
    return null; // 逾時／網路錯誤／被擋
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓一個網址的連結預覽。只抓公開頁，私網/保留位址/非 http(s)/超過重導次數一律回 null（不擋收集）。
 * @param {string} url
 * @param {{lookup?: Function, fetchImpl?: Function}} [deps] 測試用注入點；不傳則走真實 dns/fetch
 * @returns {Promise<{title: string|null, desc: string|null, host: string}|null>}
 */
export async function fetchLinkPreview(url, deps = {}) {
  const lookup = deps.lookup || defaultLookup;
  const fetchImpl = deps.fetchImpl || fetch;

  let currentUrl = url;
  let redirects = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const parsed = await checkUrlSafe(currentUrl, lookup);
    if (!parsed) return null;

    const res = await safeFetch(fetchImpl, currentUrl);
    if (!res) return null;

    if (REDIRECT_STATUSES.has(res.status)) {
      redirects += 1;
      if (redirects > MAX_REDIRECTS) return null;
      const location = res.headers.get('location');
      if (!location) return null;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      continue; // 回到迴圈開頭，對新的 currentUrl 重跑完整安全檢查
    }

    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      return { title: null, desc: null, host: parsed.host };
    }

    const html = await readBoundedText(res, MAX_BODY_BYTES);
    const { title, desc } = parseLinkMeta(html);
    return { title: sanitize(title), desc: sanitize(desc), host: parsed.host };
  }
}
