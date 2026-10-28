// SPDX-License-Identifier: GPL-3.0-or-later
import { cloneElement, isValidElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import CatGIFsPanel from './GifPicker';
import type { DiscordModules } from '@valenced/discord/types';
import type { JsonStorage } from '@valenced/json-storage';
import type { ReactElement, ReactNode } from 'react';
import type { Settings } from './settings';

export const CATGIFS_TAB = 'catgifs';
type ControlState = DiscordModules.Components.SegmentedControlState;
type Element = ReactElement<{ children?: ReactNode; state?: ControlState }>;

export interface NativePickerProps {
  channel?: { id: string };
  expressionType?: string;
  visibleTabs?: string[];
  inPortalKeyboard?: boolean;
}

export type NativePicker = (props: NativePickerProps) => ReactNode;

export interface PickerRuntime {
  active: boolean;
  storage: JsonStorage<Settings>;
  subscribe(listener: () => void): () => void;
  resetters: Set<() => void>;
  select(channelId: string | undefined, url: string): Promise<string | null>;
}

function findControl(node: ReactNode): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findControl(child);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; state?: ControlState }>(node)) return null;
  if (Array.isArray(node.props.state?.items) && typeof node.props.state.setActiveIndex === 'function') return node;
  return findControl(node.props.children);
}

function replaceControl(node: ReactNode, target: Element, replacement: Element): ReactNode {
  if (node === target) return replacement;
  if (Array.isArray(node)) return node.map(child => replaceControl(child, target, replacement));
  if (!isValidElement<{ children?: ReactNode }>(node) || node.props.children == null) return node;
  return cloneElement(node, undefined, replaceControl(node.props.children, target, replacement));
}

export function findPickerParts(tree: ReactNode) {
  if (!isValidElement<{ children?: ReactNode }>(tree)) return null;
  const children = tree.props.children;
  if (!Array.isArray(children) || children.length < 2) return null;
  const control = findControl(children[0]);
  const body = children[1];
  if (!control || !isValidElement<{ children?: ReactNode }>(body)) return null;
  return { root: tree, children, header: children[0], control, body };
}

export default function ExtendedExpressionPicker({ Native, nativeProps, runtime }: {
  Native: NativePicker;
  nativeProps: NativePickerProps;
  runtime: PickerRuntime;
}) {
  const enabled = useSyncExternalStore(runtime.subscribe, () => runtime.active);
  const [selected, setSelected] = useState(false);
  const selectedRef = useRef(false);
  const stateRef = useRef<ControlState | null>(null);
  const previousIndex = useRef(0);
  // Keep Discord's hooks in the same order while rendering its picker.
  const tree = Native(nativeProps);

  useEffect(() => {
    const reset = () => {
      if (!selectedRef.current) return;
      selectedRef.current = false;
      setSelected(false);
      stateRef.current?.setActiveIndex(previousIndex.current, false, true);
    };
    runtime.resetters.add(reset);
    return () => { runtime.resetters.delete(reset); };
  }, [runtime]);

  useEffect(() => {
    selectedRef.current = false;
    setSelected(false);
  }, [nativeProps.channel?.id, nativeProps.expressionType]);

  if (!enabled) return tree;
  const parts = findPickerParts(tree);
  if (!parts) return tree;
  const state = parts.control.props.state!;
  stateRef.current = state;
  const nativeItems = state.items.filter(item => item.id !== CATGIFS_TAB);
  const index = nativeItems.length;
  const control = cloneElement(parts.control, {
    state: {
      ...state,
      items: [...nativeItems, { id: CATGIFS_TAB, label: 'CatGIFs', page: null }],
      setActiveIndex(next, hapticFeedback, immediate) {
        if (!runtime.active) return;
        if (next === index) {
          if (!selected) previousIndex.current = Math.max(0, Math.min(index - 1, Math.round(state.activeIndex.value)));
          selectedRef.current = true;
          state.activeIndex.value = index;
          setSelected(true);
        } else {
          previousIndex.current = next;
          selectedRef.current = false;
          setSelected(false);
          state.setActiveIndex(next, hapticFeedback, immediate);
        }
      },
    },
  });
  const channelId = nativeProps.channel?.id;
  const body = selected
    ? cloneElement(parts.body, undefined, <CatGIFsPanel key={channelId} storage={runtime.storage}
        onSelect={url => runtime.select(channelId, url)} />)
    : parts.body;
  return cloneElement(parts.root, undefined,
    replaceControl(parts.header, parts.control, control),
    body,
    ...parts.children.slice(2),
  );
}
