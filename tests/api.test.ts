// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { DEFAULT_ENDPOINT, filterGifs, getEndpoint, gifName, loadGifs, normalizeGifUrl } from '../plugins/catgifs/src/api.ts';

afterEach(() => mock.restoreAll());

test('endpoint parsing accepts custom HTTP origins and rejects invalid schemes and credentials', () => {
  assert.equal(getEndpoint(' https://catgifs.marni.cc/path?q=x ')?.href, `${DEFAULT_ENDPOINT}/`);
  assert.equal(getEndpoint('http://192.168.1.5:8080')?.origin, 'http://192.168.1.5:8080');
  for (const value of ['', 'catgifs.marni.cc', 'file:///tmp/cat.gif', 'javascript:alert(1)', 'https://user:secret@catgifs.marni.cc']) {
    assert.equal(getEndpoint(value), null);
  }
});

test('library URLs match desktop origin normalization and reject non-GIF media', () => {
  const endpoint = new URL(DEFAULT_ENDPOINT);
  assert.equal(normalizeGifUrl('/gifs/cat.GIF?size=1', endpoint), `${DEFAULT_ENDPOINT}/gifs/cat.GIF?size=1`);
  assert.equal(normalizeGifUrl('https://old.example/gifs/cat.gif', endpoint), `${DEFAULT_ENDPOINT}/gifs/cat.gif`);
  for (const value of [null, 3, {}, '/cat.png', 'data:image/gif;base64,AAA', 'javascript:cat.gif']) {
    assert.equal(normalizeGifUrl(value, endpoint), null);
  }
});

test('search uses decoded filenames and ignores URL query parameters', () => {
  const gifs = [`${DEFAULT_ENDPOINT}/happy_cat.gif?name=angry`, `${DEFAULT_ENDPOINT}/sleepy%20cat.gif`, `${DEFAULT_ENDPOINT}/bad%zz.gif`];
  assert.deepEqual(filterGifs(gifs, ' HAPPY CAT '), [gifs[0]]);
  assert.deepEqual(filterGifs(gifs, 'sleepy cat'), [gifs[1]]);
  assert.deepEqual(filterGifs(gifs, 'angry'), []);
  assert.deepEqual(filterGifs(gifs, '  '), gifs);
  assert.equal(gifName(gifs[2]), 'bad%zz');
});

test('library request uses GET without authentication, deduplicates results, and forwards cancellation', async () => {
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `${DEFAULT_ENDPOINT}/api/gifs`);
    assert.deepEqual(options, { signal: controller.signal });
    return Response.json(['/cats/a.gif', '/cats/a.gif', '/cats/b.gif', '/cats/no.png', null]);
  });
  assert.deepEqual(await loadGifs(DEFAULT_ENDPOINT, controller.signal), [`${DEFAULT_ENDPOINT}/cats/a.gif`, `${DEFAULT_ENDPOINT}/cats/b.gif`]);
});

test('library errors and cancellation propagate for the picker to show or discard', async () => {
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(loadGifs(DEFAULT_ENDPOINT, controller.signal), /HTTP 503/);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ gifs: [] }));
  await assert.rejects(loadGifs(DEFAULT_ENDPOINT, controller.signal), /GIF list/);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    options.signal?.throwIfAborted();
    throw new Error('Unexpected request');
  });
  controller.abort();
  await assert.rejects(loadGifs(DEFAULT_ENDPOINT, controller.signal), { name: 'AbortError' });
  await assert.rejects(loadGifs('invalid', controller.signal), /valid HTTP/);
});
