import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, deviceClass, scrub } from '../build/src/meta/ErrorReport.js';

test('scrub drops origins, queries, hashes and e-mail addresses', () => {
  assert.equal(scrub('at https://breakbeat.example.com/main.js?v=3#x:10:4', 200), 'at /main.js:10:4');
  assert.equal(scrub('failed for someone@mail.example.org', 200), 'failed for <email>');
  assert.equal(scrub('x'.repeat(500), 300).length, 300);
});

test('deviceClass is coarse: browser family and platform only', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  assert.equal(deviceClass(ua), 'Safari · iOS');
});

test('a report carries no identity and fits the table limits', () => {
  const err = new TypeError('cannot read x of undefined');
  const r = buildReport('error', err, { source: 'https://host.example/app.js?token=abc', line: 12, col: 3 }, 'tutorial');
  assert.deepEqual(Object.keys(r).sort(), ['col', 'kind', 'lang', 'line', 'message', 'screen', 'source', 'stack', 'ua', 'version']);
  assert.equal(r.message, 'TypeError: cannot read x of undefined');
  assert.equal(r.source, '/app.js');
  assert.ok(!JSON.stringify(r).includes('token'));
  assert.ok((r.stack ?? '').length <= 2000);
});

test('non-Error rejections still produce a message', () => {
  assert.equal(buildReport('rejection', { code: 7 }).message, '[object Object]');
  assert.equal(buildReport('rejection', undefined).message, 'undefined');
});
