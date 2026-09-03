import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLinkPreview } from '../lib/link-preview.js';

// SSRF 回歸鎖 —— lib/link-preview.js 對群裡任何人貼的 URL 做 server-side fetch，
// 沒有防護就是教科書等級 SSRF（打內網／打 cloud metadata／讀 file://／被重導繞過）。
// 這支測試直接測 fetchLinkPreview 本體（不是像 message-record.test.js 那樣用 stub 蓋掉它），
// 因為蓋掉它正是這個洞一直沒被抓到的原因。
//
// dns.lookup 與 fetch 都用注入的 deps 假件，不打真網路／真 DNS。

function neverCalledLookup() {
  return async () => {
    throw new Error('lookup 不該被呼叫（這個 URL 應該在 DNS 查詢前就被擋掉）');
  };
}

function neverCalledFetch() {
  return async () => {
    throw new Error('fetch 不該被呼叫（這個 URL 應該在送出請求前就被擋掉）');
  };
}

function htmlResponse(html, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => html,
  };
}

function redirectResponse(location) {
  return {
    status: 302,
    ok: false,
    headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) },
    text: async () => '',
  };
}

// ---------- 惡意／危險輸入：全部回 null ----------

test('http://127.0.0.1/ → null（loopback，literal IP，不打 DNS）', async () => {
  const r = await fetchLinkPreview('http://127.0.0.1/', {
    lookup: neverCalledLookup(),
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('http://169.254.169.254/latest/meta-data → null（cloud metadata，link-local literal IP）', async () => {
  const r = await fetchLinkPreview('http://169.254.169.254/latest/meta-data', {
    lookup: neverCalledLookup(),
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('http://localhost:3000 → null（literal hostname localhost）', async () => {
  const r = await fetchLinkPreview('http://localhost:3000', {
    lookup: neverCalledLookup(),
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('file:///etc/passwd → null（scheme 不是 http/https）', async () => {
  const r = await fetchLinkPreview('file:///etc/passwd', {
    lookup: neverCalledLookup(),
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('http://user:pw@example.com → null（URL 含 userinfo）', async () => {
  const r = await fetchLinkPreview('http://user:pw@example.com', {
    lookup: neverCalledLookup(),
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('私網 CIDR 全擋：10.x / 172.16-31.x / 192.168.x / 0.0.0.0 / ::1', async () => {
  const targets = [
    'http://10.0.0.1/',
    'http://172.16.5.1/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
  ];
  for (const url of targets) {
    const r = await fetchLinkPreview(url, { lookup: neverCalledLookup(), fetchImpl: neverCalledFetch() });
    assert.equal(r, null, `${url} 應該被擋`);
  }
});

test('hostname 經 DNS 解析到私網位址 → null（且真的有呼叫注入的 lookup）', async () => {
  let called = false;
  const r = await fetchLinkPreview('http://evil-dns-rebind.test/', {
    lookup: async () => {
      called = true;
      return [{ address: '127.0.0.1', family: 4 }];
    },
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
  assert.equal(called, true, '應該有呼叫 lookup 才判定為私網');
});

test('DNS 查詢失敗（NXDOMAIN／逾時）→ null，不當成安全放行', async () => {
  const r = await fetchLinkPreview('http://does-not-resolve.test/', {
    lookup: async () => { throw new Error('ENOTFOUND'); },
    fetchImpl: neverCalledFetch(),
  });
  assert.equal(r, null);
});

test('redirect 到 http://10.0.0.1 → null（重導目標也要重新檢查）', async () => {
  let fetchCalls = 0;
  const r = await fetchLinkPreview('http://public-looking.test/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => {
      fetchCalls += 1;
      return redirectResponse('http://10.0.0.1/evil');
    },
  });
  assert.equal(r, null);
  assert.equal(fetchCalls, 1, '重導目標是私網，應該在跟過去之前就被擋下，不會再打第二次 fetch');
});

test('超過 3 次重導 → null（不會無限跟下去）', async () => {
  let fetchCalls = 0;
  const r = await fetchLinkPreview('http://public-looking.test/hop0', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url) => {
      fetchCalls += 1;
      const n = Number((url.match(/hop(\d+)/) || [])[1] || 0);
      return redirectResponse(`http://public-looking.test/hop${n + 1}`);
    },
  });
  assert.equal(r, null);
  assert.ok(fetchCalls <= 5, `重導次數應被限制在 3 跳左右，實際打了 ${fetchCalls} 次`);
});

// ---------- 正向對照：公網 URL 應該正常抓到 ----------

test('正向對照：公網 URL + stub fetch 回 <title>Hi</title> → 抓到 title', async () => {
  const r = await fetchLinkPreview('https://example.com/article', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => htmlResponse('<html><head><title>Hi</title></head><body></body></html>'),
  });
  assert.ok(r, 'fetchLinkPreview 不該對合法公網 URL 回 null');
  assert.equal(r.title, 'Hi');
  assert.equal(r.host, 'example.com');
});

test('正向對照：跟隨一次安全的重導（公網 → 公網）最後仍拿得到 title', async () => {
  let hop = 0;
  const r = await fetchLinkPreview('https://short.test/x', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => {
      hop += 1;
      if (hop === 1) return redirectResponse('https://real.test/article');
      return htmlResponse('<title>目的地文章</title>');
    },
  });
  assert.ok(r);
  assert.equal(r.title, '目的地文章');
  assert.equal(r.host, 'real.test');
});

// ---------- 輸出清洗 ----------

test('title/desc 去除 HTML tag、截斷 300 字、去控制字元', async () => {
  const longDesc = 'x'.repeat(400);
  const html = `<html><head><title>Hi <b>Bold</b> Title</title>
    <meta name="description" content="${longDesc}"></head><body></body></html>`;
  const r = await fetchLinkPreview('https://example.com/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => htmlResponse(html),
  });
  assert.equal(r.title, 'Hi Bold Title');
  assert.equal(r.desc.length, 300);
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(r.desc), '不應含控制字元');
});

test('非 text/html content-type → 回 {title:null, desc:null, host}（不擋，但不解析內文）', async () => {
  const r = await fetchLinkPreview('https://example.com/file.pdf', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => htmlResponse('%PDF-1.4...', { contentType: 'application/pdf' }),
  });
  assert.ok(r);
  assert.equal(r.title, null);
  assert.equal(r.desc, null);
  assert.equal(r.host, 'example.com');
});

test('fetch 逾時/丟例外 → null（不擋收集，呼叫端會 catch）', async () => {
  const r = await fetchLinkPreview('https://example.com/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.equal(r, null);
});
