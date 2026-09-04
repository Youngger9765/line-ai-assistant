import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 結構驗收（deterministic）— 對應 PRD「範本包五套」§驗收(BDD, 人簽) 結構段
// 每套 templates/<slug>/ 都必須有 README.md / PROMPT.md / fixtures.jsonl / 範例輸出.md
// 且各檔格式符合 PRD 規格。這支測試不對「範本輸出寫得好不好」下判斷（那是人 eval），
// 只鎖「四個檔都在、格式對、佔位符有解釋、fixtures 乾淨、AGENTS.md 有登記」。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

// slug → PRD 表內「輸出骨架」欄位的粗體項（範例輸出.md 必須包含這些字面）
const SLUGS = {
  todo: { requiredBold: ['待辦清單'] },
  weekly: { requiredBold: ['週報'] },
  actions: { requiredBold: ['表'] },
  support: { requiredBold: ['兩張表', '未回'] },
  notes: { requiredBold: ['兩層', '週回顧'] },
};

function readFile(p) {
  return fs.readFileSync(p, 'utf-8');
}

function extractPlaceholders(text) {
  return [...text.matchAll(/【[^】]+】/g)].map((m) => m[0]);
}

// README 的「## 」段落切片：回傳 { headers: string[], sections: string[] }
// sections[i] = headers[i] 之後、下一個 ## 之前的內容
function splitSections(md) {
  const lines = md.split('\n');
  const headerIdx = [];
  lines.forEach((line, i) => {
    if (line.startsWith('## ')) headerIdx.push(i);
  });
  const headers = headerIdx.map((i) => lines[i]);
  const sections = headerIdx.map((i, idx) => {
    const end = idx + 1 < headerIdx.length ? headerIdx[idx + 1] : lines.length;
    return lines.slice(i + 1, end).join('\n');
  });
  return { headers, sections };
}

test('templates/ 目錄存在，五個 slug 都有資料夾', () => {
  assert.ok(fs.existsSync(TEMPLATES_DIR), 'templates/ 目錄不存在');
  for (const slug of Object.keys(SLUGS)) {
    const dir = path.join(TEMPLATES_DIR, slug);
    assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `templates/${slug}/ 不存在`);
  }
});

for (const slug of Object.keys(SLUGS)) {
  const dir = path.join(TEMPLATES_DIR, slug);

  test(`templates/${slug}/ 四個檔都在`, () => {
    for (const f of ['README.md', 'PROMPT.md', 'fixtures.jsonl', '範例輸出.md']) {
      assert.ok(fs.existsSync(path.join(dir, f)), `templates/${slug}/${f} 不存在`);
    }
  });

  test(`templates/${slug}/README.md 恰有三個 ## 段，順序為 解決什麼／要改哪幾個字／結果長什麼樣`, () => {
    const md = readFile(path.join(dir, 'README.md'));
    const { headers } = splitSections(md);
    assert.equal(headers.length, 3, `應恰有 3 個 ## 段，實際 ${headers.length}: ${headers.join(' | ')}`);
    assert.match(headers[0], /解決/, `第一段應是「解決什麼問題」：${headers[0]}`);
    assert.match(headers[1], /改/, `第二段應是「要改哪幾個字」：${headers[1]}`);
    assert.match(headers[2], /結果|長什麼樣|貼上去/, `第三段應是「結果長什麼樣」：${headers[2]}`);
  });

  test(`templates/${slug}/PROMPT.md 含 ≥1 個【…】佔位符，且每個都在 README 第二段被解釋`, () => {
    const prompt = readFile(path.join(dir, 'PROMPT.md'));
    const placeholders = extractPlaceholders(prompt);
    assert.ok(placeholders.length >= 1, `PROMPT.md 沒有 【…】 佔位符`);

    const readme = readFile(path.join(dir, 'README.md'));
    const { sections } = splitSections(readme);
    const secondSection = sections[1] || '';
    for (const ph of placeholders) {
      assert.ok(
        secondSection.includes(ph),
        `README 第二段沒解釋佔位符 ${ph}（templates/${slug}）`
      );
    }
  });

  test(`templates/${slug}/fixtures.jsonl 15–25 行，每行 JSON 有 group/user/text/ts，不含真實電話／非 example 網域`, () => {
    const raw = readFile(path.join(dir, 'fixtures.jsonl'));
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(lines.length >= 15 && lines.length <= 25, `fixtures.jsonl 應 15–25 行，實際 ${lines.length}`);

    const phoneRe = /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/; // 台灣手機門號格式
    const idRe = /\b[A-Z][12]\d{8}\b/; // 台灣身分證格式
    const urlRe = /https?:\/\/[^\s"'）】]+/g;

    for (const [i, line] of lines.entries()) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        assert.fail(`fixtures.jsonl 第 ${i + 1} 行不是合法 JSON: ${line}`);
      }
      for (const key of ['group', 'user', 'text', 'ts']) {
        assert.ok(key in obj, `fixtures.jsonl 第 ${i + 1} 行缺欄位 ${key}`);
      }
      const text = String(obj.text ?? '');
      assert.doesNotMatch(text, phoneRe, `第 ${i + 1} 行疑似真實電話號碼: ${text}`);
      assert.doesNotMatch(text, idRe, `第 ${i + 1} 行疑似真實身分證字號: ${text}`);
      const urls = text.match(urlRe) || [];
      for (const u of urls) {
        assert.match(u, /^https?:\/\/(www\.)?example\.(com|org|net)(\/|$)/, `第 ${i + 1} 行網址須為 example 網域: ${u}`);
      }
    }
  });

  test(`templates/${slug}/範例輸出.md 含骨架必要標題`, () => {
    const output = readFile(path.join(dir, '範例輸出.md'));
    for (const term of SLUGS[slug].requiredBold) {
      assert.ok(output.includes(term), `範例輸出.md 缺骨架標題「${term}」（templates/${slug}）`);
    }
  });
}

// 範本 5（學習筆記）練到連結標題功能：fixtures 裡含 URL 的訊息要有 linkTitle 抓到與抓不到兩種情況
// （對應 lib/link-preview.js 產出的 linkTitle/linkDesc/linkHost，見 lib/message-record.js）
test('templates/notes/fixtures.jsonl 練到 linkTitle 抓到與抓不到兩種情況', () => {
  const raw = readFile(path.join(TEMPLATES_DIR, 'notes', 'fixtures.jsonl'));
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const objs = lines.map((l) => JSON.parse(l));

  const withTitle = objs.filter((o) => typeof o.linkTitle === 'string' && o.linkTitle.length > 0);
  assert.ok(withTitle.length >= 5, `至少要有 5 則 linkTitle 非空，實際 ${withTitle.length}`);
  for (const o of withTitle) {
    assert.ok(o.linkTitle.length <= 120, `linkTitle 應 ≤120 字: ${o.linkTitle}`);
    assert.ok('linkDesc' in o, `有 linkTitle 就該有 linkDesc 欄位: ${JSON.stringify(o)}`);
    assert.ok('linkHost' in o, `有 linkTitle 就該有 linkHost 欄位: ${JSON.stringify(o)}`);
  }

  const nullTitle = objs.filter(
    (o) => 'linkTitle' in o && o.linkTitle === null && /https?:\/\//.test(String(o.text ?? ''))
  );
  assert.ok(nullTitle.length >= 1, `至少要有 1 則含網址但 linkTitle 為 null（模擬抓不到），實際 ${nullTitle.length}`);
});

// 急件關鍵字不該吃到否定寫法（「不急」「不用急」「慢慢來」）
test('templates/todo/PROMPT.md 有排除「不急」類否定寫法的規則', () => {
  const prompt = readFile(path.join(TEMPLATES_DIR, 'todo', 'PROMPT.md'));
  assert.match(prompt, /不急/, 'PROMPT.md 應提到排除「不急」類否定寫法不算急件');
});

test('AGENTS.md 有「## 範本」段且五個 slug 都列到', () => {
  const agents = readFile(path.join(ROOT, 'AGENTS.md'));
  assert.match(agents, /##\s*範本/, 'AGENTS.md 缺「## 範本」段');
  const section = agents.split(/##\s*範本/)[1] || '';
  for (const slug of Object.keys(SLUGS)) {
    assert.ok(section.includes(slug), `AGENTS.md「## 範本」段沒列到 slug: ${slug}`);
  }
});
