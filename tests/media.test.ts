// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { gifDimensions, loadGifItems } from '../plugins/catgifs/src/media.ts';

afterEach(() => mock.restoreAll());
const header = (width: number, height: number) => new Uint8Array([71, 73, 70, 56, 57, 97, width & 255, width >> 8, height & 255, height >> 8]);

test('GIF headers supply exact dimensions before the grid renders', () => {
  assert.deepEqual(gifDimensions(header(804, 960)), { width: 804, height: 960 });
  const gif87 = header(320, 162);
  gif87[4] = 55;
  assert.deepEqual(gifDimensions(gif87), { width: 320, height: 162 });
  assert.equal(gifDimensions(header(0, 960)), null);
  assert.equal(gifDimensions(new Uint8Array([1, 2, 3])), null);
  assert.equal(gifDimensions(new Uint8Array(10)), null);
});

test('dimension requests read ten bytes, keep library order, and reuse cached dimensions', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.deepEqual(options.headers, { Range: 'bytes=0-9' });
    return new Response(url.includes('wide') ? header(400, 200) : header(200, 400), { status: 206 });
  });
  const urls = ['https://example.test/wide.gif', 'https://example.test/tall.gif'];
  const signal = new AbortController().signal;
  const items = await loadGifItems(urls, signal);
  assert.deepEqual(items.map(({ url, width, height, format }) => ({ url, width, height, format })), [
    { url: urls[0], width: 400, height: 200, format: 1 },
    { url: urls[1], width: 200, height: 400, format: 1 },
  ]);
  await loadGifItems(urls, signal);
  assert.equal(calls, 2);
});

test('servers without range support use a stable fallback without reading the whole animation', async () => {
  const response = new Response('not a range response');
  mock.method(response, 'arrayBuffer', async () => { throw new Error('Must not buffer a full animation'); });
  mock.method(globalThis, 'fetch', async () => response);
  const [item] = await loadGifItems(['https://example.test/no-ranges.gif'], new AbortController().signal);
  assert.equal(item.width, 180);
  assert.equal(item.height, 180);
});

test('dimension requests have bounded concurrency and stop on cancellation', async () => {
  let active = 0;
  let maximum = 0;
  mock.method(globalThis, 'fetch', async () => {
    active++;
    maximum = Math.max(active, maximum);
    await Promise.resolve();
    active--;
    return new Response(header(180, 180), { status: 206 });
  });
  const urls = Array.from({ length: 20 }, (_, i) => `https://example.test/concurrency-${i}.gif`);
  const controller = new AbortController();
  assert.equal((await loadGifItems(urls, controller.signal)).length, 20);
  assert.ok(maximum <= 6);
  controller.abort();
  await assert.rejects(loadGifItems(['https://example.test/cancelled.gif'], controller.signal), /cancelled/);
});
