// SPDX-License-Identifier: GPL-3.0-or-later

export const DEFAULT_ENDPOINT = 'https://catgifs.marni.cc';

export function getEndpoint(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return new URL('/', url);
  } catch {
    return null;
  }
}

export function normalizeGifUrl(value: unknown, endpoint: URL): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || !/\.gif$/i.test(url.pathname)) return null;
    // Match the desktop plugin: serve library paths from the configured endpoint.
    return new URL(`${url.pathname}${url.search}${url.hash}`, endpoint.origin).href;
  } catch {
    return null;
  }
}

export function gifName(url: string): string {
  const path = new URL(url).pathname;
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.gif$/i, '');
  let name = filename;
  try { name = decodeURIComponent(filename); } catch { /* Keep malformed escapes readable. */ }
  return name.replace(/[-_]/g, ' ');
}

export function filterGifs(gifs: readonly string[], query: string): string[] {
  const search = query.trim().toLowerCase();
  return gifs.filter(url => !search || gifName(url).toLowerCase().includes(search));
}

export async function loadGifs(endpointValue: string, signal: AbortSignal): Promise<string[]> {
  const endpoint = getEndpoint(endpointValue);
  if (!endpoint) throw new Error('Enter a valid HTTP or HTTPS API base URL in CatGIFs settings.');
  const response = await fetch(new URL('/api/gifs', endpoint).href, { signal });
  if (!response.ok) throw new Error(`The CatGIFs API returned HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The CatGIFs API did not return a GIF list.');
  return [...new Set(payload.map(value => normalizeGifUrl(value, endpoint))
    .filter((url): url is string => url !== null))];
}
