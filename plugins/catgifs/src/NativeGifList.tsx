// SPDX-License-Identifier: GPL-3.0-or-later
import { FlashList } from '@shopify/flash-list';
import { getModuleWithImportedPath, lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders';
import { BottomSheet as Gorhom } from '@valenced/externals/gorhom';
import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { gifName } from './api';
import type { ComponentType } from 'react';
import type { ScrollViewProps } from 'react-native';
import type { GifItem } from './media';

const RESULTS_PATH = 'modules/gif_picker/native/GIFPickerResultsList.tsx';

interface NativeListProps {
  columns: number;
  columnWidth: number;
  loading: boolean;
  inActionSheet: boolean;
  resultItems: GifItem[];
  onPressGIF(item: string | GifItem): void;
  keyboardDismissMode: 'on-drag';
}

type ResultsModule = { default: ComponentType<NativeListProps> };

function SheetScrollView(props: ScrollViewProps) {
  return <Gorhom.BottomSheetScrollView {...props} children={props.children} />;
}

export default function NativeGifList({ items, width, inActionSheet, onSelect }: {
  items: GifItem[];
  width: number;
  inActionSheet: boolean;
  onSelect(url: string): void;
}) {
  const [Results, setResults] = useState(() => lookupModuleWithImportedPath<ResultsModule>(RESULTS_PATH)[0]?.default);
  useEffect(() => {
    if (Results) return;
    return getModuleWithImportedPath<ResultsModule>(RESULTS_PATH, module => setResults(() => module.default));
  }, [Results]);
  const columns = Math.max(width < 240 ? 1 : 2, Math.min(4, Math.floor(width / 180)));
  const columnWidth = (width - (columns - 1) * 8) / columns;
  if (Results) return <Results columns={columns} columnWidth={columnWidth} loading={false}
    inActionSheet={inActionSheet} resultItems={items} keyboardDismissMode="on-drag"
    onPressGIF={item => onSelect(typeof item === 'string' ? item : item.url)} />;

  // The native list can be loaded lazily on first use. Match its geometry until it becomes available.
  return <View style={{ flex: 1, marginHorizontal: -4 }}><FlashList<GifItem> key={columns} data={items} masonry numColumns={columns}
    optimizeItemArrangement drawDistance={180} maintainVisibleContentPosition={{ disabled: true }}
    renderScrollComponent={inActionSheet ? SheetScrollView : undefined}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ paddingBottom: 64 }} keyExtractor={item => item.url}
    renderItem={({ item }) => <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}><Pressable accessibilityRole="button"
      accessibilityLabel={`Send ${gifName(item.url)}`} onPress={() => onSelect(item.url)}
      style={({ pressed }) => ({ width: columnWidth,
        borderRadius: 8, overflow: 'hidden', opacity: pressed ? 0.65 : 1 })}>
      <Image source={{ uri: item.src }} resizeMode="cover"
        style={{ width: columnWidth, height: columnWidth * item.height / item.width }} />
    </Pressable></View>} /></View>;
}
