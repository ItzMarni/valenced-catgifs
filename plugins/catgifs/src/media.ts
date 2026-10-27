// SPDX-License-Identifier: GPL-3.0-or-later

export interface GifItem {
  url: string;
  src: string;
  format: 1;
  width: number;
  height: number;
  order: number;
}

interface Dimensions { width: number; height: number }
const dimensionsCache = new Map<string, Dimensions>();
const DEFAULT_DIMENSIONS: Dimensions = { width: 180, height: 180 };

export function gifDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 10 || bytes[0] !== 71 || bytes[1] !== 73 || bytes[2] !== 70 ||
      bytes[3] !== 56 || (bytes[4] !== 55 && bytes[4] !== 57) || bytes[5] !== 97) return null;
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function readDimensions(url: string, signal: AbortSignal): Promise<Dimensions> {
  const cached = dimensionsCache.get(url);
  if (cached) return cached;
  try {
    // GIF dimensions live in the first ten bytes. Avoid downloading every animation to measure it.
    const response = await fetch(url, { headers: { Range: 'bytes=0-9' }, signal });
    if (response.status !== 206) return DEFAULT_DIMENSIONS;
    const dimensions = gifDimensions(new Uint8Array(await response.arrayBuffer()));
    if (!dimensions) return DEFAULT_DIMENSIONS;
    if (dimensionsCache.size >= 512) dimensionsCache.delete(dimensionsCache.keys().next().value!);
    dimensionsCache.set(url, dimensions);
    return dimensions;
  } catch (error) {
    if (signal.aborted) throw error;
    return DEFAULT_DIMENSIONS;
  }
}

export async function loadGifItems(urls: string[], signal: AbortSignal): Promise<GifItem[]> {
  const items = new Array<GifItem>(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      if (signal.aborted) throw new Error('GIF loading cancelled.');
      const index = next++;
      const url = urls[index];
      const dimensions = await readDimensions(url, signal);
      items[index] = { url, src: url, format: 1, order: index, ...dimensions };
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return items;
}
