// SPDX-License-Identifier: GPL-3.0-or-later
import { getAssetIdByName } from '@valenced/assets';
import SearchInput from '@valenced/components/SearchInput';
import { Design } from '@valenced/discord/design';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { filterGifs, loadGifs } from './api';
import { loadGifItems } from './media';
import NativeGifList from './NativeGifList';
import { DEFAULT_SETTINGS } from './settings';
import type { JsonStorage } from '@valenced/json-storage';
import type { ViewStyle } from 'react-native';
import type { GifItem } from './media';
import type { Settings } from './settings';

export interface PickerProps {
  storage: JsonStorage<Settings>;
  inActionSheet: boolean;
  onSelect(url: string): Promise<string | null>;
}

export default function CatGIFsPanel({ storage, onSelect, inActionSheet }: PickerProps) {
  const { apiEndpoint } = { ...DEFAULT_SETTINGS, ...storage.use() };
  const [width, setWidth] = useState(0);
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const visible = useMemo(() => {
    const urls = new Set(filterGifs(gifs.map(item => item.url), query));
    return gifs.filter(item => urls.has(item.url));
  }, [gifs, query]);
  const refreshIcon = getAssetIdByName('RetryIcon', 'png');

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20_000);
    setLoading(true);
    setError('');
    setGifs([]);
    loadGifs(apiEndpoint, controller.signal)
      .then(urls => loadGifItems(urls, controller.signal))
      .then(items => { if (!disposed) setGifs(items); })
      .catch((reason: unknown) => {
        if (disposed) return;
        setError(timedOut ? 'CatGIFs took too long to respond. Try again.' :
          reason instanceof Error ? reason.message : 'Could not load GIFs. Check your connection.');
      })
      .finally(() => {
        clearTimeout(timer);
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiEndpoint, refresh]);

  return (
    <View style={styles.body} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.toolbar}>
          <View style={styles.search}>
            <SearchInput placeholder="Search CatGIFs" value={query} onChange={setQuery} isClearable />
          </View>
          {refreshIcon !== undefined ? <Design.IconButton icon={refreshIcon}
            accessibilityLabel="Refresh CatGIFs" variant="tertiary" size="sm" disabled={loading}
            onPress={() => setRefresh(value => value + 1)} /> : null}
        </View>
        {selectionError ? <Design.Text variant="text-sm/normal" color="text-feedback-critical" accessibilityRole="alert">
          {selectionError}
        </Design.Text> : null}
        {loading ? <View style={styles.state} accessibilityLabel="Loading GIFs" accessibilityRole="progressbar">
          <ActivityIndicator />
          <Design.Text variant="text-md/normal" color="text-default">Loading GIFs…</Design.Text>
        </View> : error ? <View style={styles.state}>
          <Design.Text variant="text-md/normal" color="text-feedback-critical" accessibilityRole="alert">{error}</Design.Text>
          <Design.Button text="Try again" size="md" onPress={() => setRefresh(value => value + 1)} />
        </View> : visible.length === 0 ? <View style={styles.state}>
          <Design.Text variant="text-md/normal" color="text-muted">
            {query.trim() ? 'No GIFs match your search.' : 'No GIFs available.'}
          </Design.Text>
        </View> : width > 0 ? <NativeGifList items={visible} width={width} inActionSheet={inActionSheet}
          onSelect={url => { void onSelect(url).then(error => setSelectionError(error ?? '')); }} /> : null}
    </View>
  );
}

const styles = {
  body: { flex: 1, minHeight: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', height: 56, gap: 8 },
  search: { flex: 1 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
} satisfies Record<string, ViewStyle>;
