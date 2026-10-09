import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Postgres KV lazily initializes once and parameterizes CRUD/scan', async () => {
  const originalUrl = process.env.POSTGRES_URL;
  const originalMock = globalThis.__postgresMock;
  const rows = new Map();
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.startsWith('SELECT value')) return rows.has(values[0]) ? [{ value: rows.get(values[0]) }] : [];
    if (query.startsWith('INSERT INTO')) { rows.set(values[0], values[1]); return []; }
    if (query.startsWith('DELETE FROM')) { rows.delete(values[0]); return []; }
    if (query.startsWith('SELECT key')) {
      const regex = new RegExp('^' + values[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$');
      return [...rows.keys()].filter((key) => regex.test(key)).map((key) => ({ key }));
    }
    return [];
  };
  sql.json = (value) => value;
  globalThis.__postgresMock = (_url, options) => {
    assert.deepEqual(options, { prepare: false, max: 1, idle_timeout: 20 });
    return sql;
  };
  process.env.POSTGRES_URL = 'postgres://localhost/mock';
  try {
    const source = readFileSync(new URL('../lib/redis.js', import.meta.url), 'utf8')
      .replace("import { Redis } from '@upstash/redis';", 'const Redis = class {};')
      .replace("(await import('postgres')).default", 'globalThis.__postgresMock');
    const { kv, store } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    assert.equal(store, 'postgres');
    assert.equal(calls.length, 0, 'driver is lazy');
    assert.equal(await kv.get('missing'), null);
    await kv.set('msg:G1:1', { text: 'hello' });
    await kv.set('group:G1', { name: 'One' });
    assert.deepEqual(await kv.get('msg:G1:1'), { text: 'hello' });
    assert.deepEqual(await kv.scan(0, { match: 'msg:*' }), ['0', ['msg:G1:1']]);
    assert.equal(await kv.del('msg:G1:1'), 1);
    assert.equal(await kv.get('msg:G1:1'), null);
    assert.equal(calls.filter((c) => c.query.startsWith('CREATE TABLE')).length, 1);
    assert.equal(calls.filter((c) => c.query.startsWith('ALTER TABLE')).length, 1);
    assert.ok(calls.some((c) => c.query.startsWith('SELECT key') && c.values[0] === 'msg:%'));
    assert.ok(calls.every((c) => !c.query.includes('msg:G1:1')));
  } finally {
    if (originalUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = originalUrl;
    if (originalMock === undefined) delete globalThis.__postgresMock;
    else globalThis.__postgresMock = originalMock;
  }
});
