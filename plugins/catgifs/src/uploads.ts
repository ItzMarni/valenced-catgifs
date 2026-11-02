// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULT_ENDPOINT, getEndpoint } from './api.ts';
import type { JsonStorage } from '@valenced/json-storage';
import type { Settings } from './settings';

export async function submitGif(storage: JsonStorage<Settings>, source: string, signal: AbortSignal): Promise<void> {
  const base = uploadBase(storage.cache?.apiEndpoint ?? DEFAULT_ENDPOINT);
  const connection = storage.cache?.uploadConnection;
  if (connection?.origin !== base.origin || !connection.token) throw new Error('Connect CatGIFs in plugin settings first.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 30_000);
  try { await uploadGif(base, connection.token, source, controller.signal); }
  catch (error) {
    if (error instanceof ConnectionExpiredError && storage.cache?.uploadConnection?.token === connection.token) {
      await storage.set({ uploadConnection: null });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function uploadBase(endpoint: string): URL {
  const base = getEndpoint(endpoint);
  if (!base || (base.origin !== 'https://catgifs.marni.cc' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new Error('Set API Base URL to catgifs.marni.cc or a localhost address before connecting.');
  }
  return base;
}

interface MediaLink { proxyURL?: string; proxy_url?: string; url?: string; content_type?: string }
interface MediaProps {
  src?: string; itemSrc?: string; itemHref?: string; url?: string; href?: string;
  attachment?: MediaLink;
  message?: {
    content?: string;
    attachments?: MediaLink[];
    embeds?: { image?: MediaLink; thumbnail?: MediaLink; video?: MediaLink }[];
  };
}

export function mediaSource(props: MediaProps): string | null {
  const message = props.message;
  const attachments = message?.attachments ?? [];
  const attachment = props.attachment ?? attachments.find(item =>
    item.content_type?.includes('gif') || /\.gif([?#]|$)/i.test(item.url ?? '')) ?? attachments[0];
  const embeds = message?.embeds ?? [];
  const candidates = [props.src, props.itemSrc, props.itemHref, props.url, props.href,
    attachment?.proxy_url, attachment?.url,
    ...embeds.flatMap(embed => [embed.image, embed.thumbnail, embed.video]
      .flatMap(item => [item?.proxyURL, item?.proxy_url, item?.url])),
    ...(typeof message?.content === 'string' ? message.content.match(/https?:\/\/\S+\.(?:gif|webp|png|jpe?g|mp4)(?:\?\S*)?/gi) ?? [] : [])];
  return candidates.find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) ?? null;
}

async function post(base: URL, path: string, body: object, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 20_000);
  try {
    return await fetch(new URL(`/api/equicord/${path}`, base).href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'omit', signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && !signal.aborted) throw new Error('CatGIFs took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Connection cancelled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function connectAccount(base: URL, signal: AbortSignal,
  approve: (url: string, code: string) => Promise<void>): Promise<string> {
  const start = await post(base, 'device', { device_name: 'Discord mobile (Valenced)' }, signal);
  if (!start.ok) throw new Error(start.status === 429
    ? 'Too many connection attempts. Try again in a minute.' : `Could not start the CatGIFs connection (HTTP ${start.status}).`);
  const grant = await start.json();
  if (!grant || typeof grant.device_code !== 'string' || typeof grant.user_code !== 'string' ||
      typeof grant.verification_uri_complete !== 'string' ||
      !Number.isFinite(grant.expires_in) || grant.expires_in <= 0 ||
      !Number.isFinite(grant.interval) || grant.interval < 0) {
    throw new Error('CatGIFs returned an invalid connection response.');
  }
  const verification = new URL(grant.verification_uri_complete);
  if (verification.origin !== base.origin || verification.username || verification.password) {
    throw new Error('CatGIFs returned an invalid approval URL.');
  }
  const expiresAt = Date.now() + grant.expires_in * 1000;
  await approve(verification.href, grant.user_code);
  let interval = Math.max(5, grant.interval) * 1000;
  while (Date.now() < expiresAt) {
    await wait(Math.min(interval, expiresAt - Date.now()), signal);
    if (Date.now() >= expiresAt) break;
    const response = await post(base, 'token', { device_code: grant.device_code }, signal);
    const result = await response.json();
    if (!result || typeof result !== 'object') throw new Error('CatGIFs returned an invalid connection response.');
    if (response.ok && result.status === 'authorized' && typeof result.access_token === 'string' && result.access_token) {
      return result.access_token;
    }
    if (response.status === 429) { interval = Math.max(interval + 5000, 10000); continue; }
    if (result.status === 'authorization_pending') continue;
    if (result.status === 'expired') break;
    if (result.status === 'access_denied') throw new Error('CatGIFs denied this connection, or the account is inactive.');
    if (result.status === 'device_limit_reached') throw new Error('This account has reached its connected device limit.');
    throw new Error(typeof result.error === 'string' ? result.error : 'Could not finish connecting to CatGIFs.');
  }
  throw new Error('That connection code expired. Start again to get a new one.');
}

export async function uploadGif(base: URL, token: string, url: string, signal: AbortSignal): Promise<void> {
  if (!token) throw new Error('Connect CatGIFs in plugin settings first.');
  const source = new URL(url.trim());
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) {
    throw new Error('This image URL is not supported.');
  }
  const host = source.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      /^(?:0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      host === '[::]' || host === '[::1]' || /^\[(?:f[cd]|fe[89ab]|::ffff:)/i.test(host)) {
    throw new Error('Private network media links cannot be uploaded.');
  }
  if (/\.gif$/i.test(source.pathname) && source.searchParams.get('format') === 'webp') source.searchParams.set('format', 'gif');
  const name = source.pathname.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'discord-gif.gif';
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4' };
  const type = types[extension ?? ''] ?? 'application/octet-stream';
  const form = new FormData();
  // React Native's multipart implementation downloads HTTP file URIs on Android.
  form.append('file', { uri: source.href, name, type } as unknown as Blob);
  const response = await fetch(new URL('/api/equicord/uploads', base).href, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: form, credentials: 'omit', signal,
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) throw new ConnectionExpiredError();
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'CatGIFs could not accept this GIF.');
}

export class ConnectionExpiredError extends Error {
  constructor() { super('CatGIFs connection expired or was revoked. Reconnect in plugin settings.'); }
}
