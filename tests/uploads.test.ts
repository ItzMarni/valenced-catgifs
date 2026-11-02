// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectAccount, mediaSource, submitGif, uploadBase, uploadGif } from '../plugins/catgifs/src/uploads.ts';

const base = new URL('https://catgifs.marni.cc');
const grant = {
  device_code: 'device-code', user_code: 'CAT-CODE',
  verification_uri_complete: `${base.origin}/connect?code=CAT-CODE`, expires_in: 600, interval: 5,
};

afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test('upload connections match desktop allowed origins', () => {
  for (const endpoint of [base.origin, 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
    assert.equal(uploadBase(endpoint).origin, endpoint);
  }
  for (const endpoint of ['https://example.com', 'http://catgifs.marni.cc', 'https://user:pass@catgifs.marni.cc', 'invalid']) {
    assert.throws(() => uploadBase(endpoint), /API Base URL/);
  }
});

test('media menus select direct media, GIF attachments, and embed proxies', () => {
  const gif = 'https://cdn.discordapp.com/cat.gif';
  assert.equal(mediaSource({ src: gif }), gif);
  assert.equal(mediaSource({ message: { attachments: [
    { url: 'https://cdn.discordapp.com/cat.png' }, { url: gif, proxy_url: `${gif}?proxy=1` },
  ] } }), `${gif}?proxy=1`);
  assert.equal(mediaSource({ message: { embeds: [{ image: { proxyURL: gif } }] } }), gif);
  assert.equal(mediaSource({ message: { content: `hello ${gif}?size=1` } }), `${gif}?size=1`);
  assert.equal(mediaSource({ message: { content: 'hello there' } }), null);
  assert.equal(mediaSource({ src: 'file:///private/cat.gif' }), null);
});

test('device approval polls pending authorization and honors rate limiting', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let polls = 0;
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal);
    if (url.endsWith('/device')) {
      assert.deepEqual(JSON.parse(String(options.body)), { device_name: 'Discord mobile (Valenced)' });
      return Response.json(grant);
    }
    assert.equal(url, `${base.origin}/api/equicord/token`);
    assert.deepEqual(JSON.parse(String(options.body)), { device_code: grant.device_code });
    polls++;
    if (polls === 1) return Response.json({ status: 'authorization_pending' });
    if (polls === 2) return Response.json({ error: 'slow_down' }, { status: 429 });
    return Response.json({ status: 'authorized', access_token: 'test-token' });
  });
  const { promise: approved, resolve } = Promise.withResolvers<void>();
  const connection = connectAccount(base, new AbortController().signal, async (url, code) => {
    assert.equal(url, grant.verification_uri_complete);
    assert.equal(code, grant.user_code);
    resolve();
  });
  await approved;
  // Allow each mocked fetch/json continuation to schedule its next poll.
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  mock.timers.tick(5000); await flush();
  assert.equal(polls, 1);
  mock.timers.tick(5000); await flush();
  assert.equal(polls, 2);
  mock.timers.tick(9999); await flush();
  assert.equal(polls, 2);
  mock.timers.tick(1); await flush();
  assert.equal(await connection, 'test-token');
});

test('device approval rejects foreign approval URLs and malformed grants', async () => {
  let opened = false;
  for (const invalid of [null, { ...grant, interval: -1 }, { ...grant, verification_uri_complete: 'https://example.com/connect' }]) {
    mock.method(globalThis, 'fetch', async () => Response.json(invalid));
    await assert.rejects(connectAccount(base, new AbortController().signal, async () => { opened = true; }), /invalid/);
    mock.restoreAll();
  }
  assert.equal(opened, false);
});

test('leaving settings cancels a pending device connection', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(grant));
  const controller = new AbortController();
  await assert.rejects(connectAccount(base, controller.signal, async () => { controller.abort(); }), /cancelled/);
});

test('Android uploads use a native multipart file URI and send the token only to CatGIFs', async () => {
  const parts: unknown[][] = [];
  mock.method(FormData.prototype, 'append', function (...args: unknown[]) { parts.push(args); });
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `${base.origin}/api/equicord/uploads`);
    assert.deepEqual(options.headers, { Authorization: 'Bearer test-token' });
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.signal, controller.signal);
    assert.ok(options.body instanceof FormData);
    return Response.json({ status: 'submitted' }, { status: 201 });
  });
  await uploadGif(base, 'test-token', 'https://media.discordapp.net/cat.gif?format=webp', controller.signal);
  assert.deepEqual(parts, [['file', {
    uri: 'https://media.discordapp.net/cat.gif?format=gif', name: 'cat.gif', type: 'image/gif',
  }]]);
});

test('uploads reject unsupported URLs and report API rejections', async () => {
  let requests = 0;
  mock.method(FormData.prototype, 'append', () => {});
  mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: 'Already submitted.' }, { status: 422 }); });
  const signal = new AbortController().signal;
  for (const url of ['file:///cat.gif', 'https://user:secret@example.com/cat.gif', 'http://127.0.0.1/cat.gif', 'http://192.168.1.1/cat.gif']) {
    await assert.rejects(uploadGif(base, 'test-token', url, signal), /not supported|Private network/);
  }
  assert.equal(requests, 0);
  await assert.rejects(uploadGif(base, 'test-token', 'https://example.com/cat.gif', signal), /Already submitted/);
});

test('revoked tokens are removed, and tokens from other origins are never sent', async () => {
  mock.method(FormData.prototype, 'append', () => {});
  let requests = 0;
  const storage = {
    cache: { apiEndpoint: base.origin, uploadConnection: { origin: base.origin, token: 'revoked' } },
    async set(value: object) { Object.assign(this.cache, value); },
  };
  mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({}, { status: 401 }); });
  await assert.rejects(submitGif(storage, 'https://example.com/cat.gif', new AbortController().signal), /expired or was revoked/);
  assert.equal(storage.cache.uploadConnection, null);
  storage.cache.uploadConnection = { origin: 'http://localhost:8080', token: 'other-origin' };
  await assert.rejects(submitGif(storage, 'https://example.com/cat.gif', new AbortController().signal), /Connect CatGIFs/);
  assert.equal(requests, 1);
});
