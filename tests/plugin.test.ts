// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import * as React from 'react';
import * as ReactJSXRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import { strFromU8, unzipSync } from 'fflate';
import type { Settings } from '../plugins/catgifs/src/settings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = readFileSync(new URL('../plugins/catgifs/build/js/index.js', import.meta.url), 'utf8');
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

function harness({ deferPicker = false, nativeListReady = true, messagesReady = true } = {}) {
  const SheetContext = React.createContext<object | null>({});
  let channel: string | undefined = 'channel-a';
  let availableInput = true;
  let closed = 0;
  const drafts: string[] = [];
  const errors: unknown[][] = [];
  const sent: { channelId: string; message: { content: string }; clearDraft: boolean; options: { location: string } }[] = [];
  let sendResult: () => unknown = () => undefined;
  const cleanups: (() => void)[] = [];
  const storageListeners = new Set<() => void>();
  const storage = {
    cache: { apiEndpoint: 'https://catgifs.marni.cc', keepPickerOpen: false } as Settings,
    use() {
      return React.useSyncExternalStore(listener => {
        storageListeners.add(listener);
        return () => { storageListeners.delete(listener); };
      }, () => storage.cache);
    },
    async set(value: Partial<Settings>) {
      storage.cache = { ...storage.cache, ...value };
      for (const listener of storageListeners) listener();
    },
  };
  const openedURLs: string[] = [];
  const browser = { async openURL(url: string) { openedURLs.push(url); } };
  mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/api/gifs')) return Response.json(['/wide-cat.gif', '/portrait-cat.gif']);
    const [width, height] = url.includes('wide') ? [400, 200] : [200, 400];
    return new Response(new Uint8Array([71, 73, 70, 56, 57, 97, width & 255, width >> 8, height & 255, height >> 8]), { status: 206 });
  });

  // Native tree and tab-state shape observed on Discord Android 352.6.
  function NativePicker() {
    const [page, setPage] = React.useState(0);
    const activeIndex = React.useRef({ value: 0 }).current;
    const state = {
      activeIndex,
      items: ['Emoji', 'GIFs', 'Stickers'].map(label => ({ id: label, label, page: null })),
      setActiveIndex(index: number) { activeIndex.value = index; setPage(index); },
    };
    return React.createElement('picker-root', { style: { flex: 1, height: 400 } },
      React.createElement('picker-header', null, React.createElement('segmented-control', { state })),
      React.createElement('picker-body', { style: { flex: 1 } }, React.createElement('native-page', { page })));
  }
  const Picker = React.memo(NativePicker);
  const original = Picker.type;
  let finishPicker = () => {};
  let finishNativeList = () => {};
  const sheets = {
    hideActionSheet() {},
    async openLazy(loader: Promise<object> | (() => Promise<object>), key: string, props: object) {
      return { module: await (typeof loader === 'function' ? loader() : loader), key, props };
    },
  };
  const originalOpenLazy = sheets.openLazy;
  const host = {
    react: { React, ReactJSXRuntime, ReactNative: {
      View: 'native-view', Image: 'native-image', Pressable: 'pressable', ActivityIndicator: 'spinner',
      ScrollView: 'scroll-view', Text: 'native-text', Linking: browser,
    } },
    components: { SearchInput: 'search-input' },
    assets: { getAssetIdByName: () => 1 },
    externals: { Gorhom: { BottomSheet: {
      BottomSheetScrollView: 'bottom-sheet-scroll-view',
      useBottomSheetInternal: (unsafe: boolean) => {
        assert.equal(unsafe, true);
        return React.useContext(SheetContext);
      },
    } }, Shopify: { FlashList: {
      FlashList: 'flash-list',
      useRecyclingState: (initial: unknown) => React.useState(initial),
    } } },
    discord: {
      design: { Design: { Text: 'design-text', Button: 'design-button', IconButton: 'icon-button', ActionSheetRow: 'action-sheet-row',
        TextInput: 'text-input', TableRowGroup: 'row-group', TableSwitchRow: 'switch-row' } },
      flux: { getStore(_name: string, callback: (value: object) => void) {
        callback({ getChannelId: () => channel });
        return () => {};
      } },
      utils: { modules: { finders: {
        getModuleWithImportedPath(path: string, callback: (value: object) => void) {
          if (path.endsWith('/GIFPickerResultsList.tsx')) {
            finishNativeList = () => callback({ default: 'native-gif-list' });
            return () => {};
          }
          assert.equal(path, 'modules/expression_picker/native/ExpressionPicker.tsx');
          finishPicker = () => callback({ default: Picker });
          if (!deferPicker) finishPicker();
          return () => {};
        },
        lookupModuleWithImportedPath(path: string) {
          assert.ok(path.endsWith('/GIFPickerResultsList.tsx'));
          return nativeListReady ? [{ default: 'native-gif-list' }, 10144] : [];
        },
      } } },
    },
    modules: { finders: {
      filters: { withProps: (...props: string[]) => props },
      getModules(filter: string[], callback: (value: object) => void) {
        if (filter.includes('openLazy')) { callback(sheets); return () => {}; }
        if (filter.includes('sendMessage')) {
          if (messagesReady) callback({
            receiveMessage() {},
            sendMessage(channelId: string, message: { content: string }, clearDraft: boolean, options: { location: string }) {
              sent.push({ channelId, message, clearDraft, options });
              return sendResult();
            },
          });
          return () => {};
        }
        callback({ getBestActiveInputForChannelId: (id: string) => {
          assert.equal(id, channel);
          return availableInput ? {
            insertText: (text: string) => drafts.push(text), closeCustomKeyboard: () => { closed++; },
          } : undefined;
        } });
        return () => {};
      },
    } },
    patcher: { instead(parent: typeof Picker, key: 'type', hook: Function) {
      const method = parent[key];
      parent[key] = function (...args: unknown[]) { return hook(args, method); };
      return () => { parent[key] = method; };
    } },
  };
  const options = new Function('valenced', 'plugin', `return ${bundle}`)(host, (value: unknown) => value).default;
  function start() {
    options.start({ cleanup: (...items: (() => void)[]) => cleanups.push(...items), jsonStorage: storage,
      logger: { error(...args: unknown[]) { errors.push(args); }, warn() {} } });
  }
  function stop() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); }
  const props = { channel: { id: 'channel-a' }, expressionType: 'emoji' };
  return { start, stop, options, Picker, original, props, drafts, errors, sent, storage, SheetContext, getClosed: () => closed,
    sheets, originalOpenLazy,
    SettingsComponent: options.SettingsComponent, browser, openedURLs,
    finishPicker: () => finishPicker(), finishNativeList: () => finishNativeList(), setChannel: (id?: string) => { channel = id; },
    setInput: (available: boolean) => { availableInput = available; },
    setSendResult: (result: () => unknown) => { sendResult = result; } };
}

test('startup yields before reporting Started so Valenced can register the settings route', async () => {
  const h = harness();
  const routes = new Map();
  const listeners: (() => void)[] = [];
  // Valenced 1.2.4 emits Started in finally. An init-only plugin skips the
  // awaited start callback and emits before the settings listener is installed.
  async function startPlugin() {
    try {
      if (!h.options.start) return;
      await h.start();
    } finally {
      for (const listener of listeners) listener();
    }
  }
  const starting = startPlugin();
  listeners.push(() => routes.set('cc.marni.catgifs', h.options.SettingsComponent));
  await starting;
  assert.equal(routes.get('cc.marni.catgifs'), h.SettingsComponent);
  h.stop();
});

test('native picker gains one CatGIFs tab, switches pages, and restores native tabs on disable', async () => {
  const h = harness();
  h.start();
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
  const control = () => renderer.root.findByType('segmented-control').props.state;
  assert.deepEqual(control().items.map(item => item.label), ['Emoji', 'GIFs', 'Stickers', 'CatGIFs']);
  await act(async () => { control().setActiveIndex(3); });
  assert.equal(renderer.root.findAllByType('native-page').length, 0);
  const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
  assert.equal(panel.props.style.flex, 1);
  await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const list = renderer.root.findByType('native-gif-list');
  assert.equal(list.props.columns, 2);
  assert.equal(list.props.inActionSheet, true);
  assert.equal(list.props.resultItems.length, 2);
  await act(async () => { control().setActiveIndex(1); });
  assert.equal(renderer.root.findByType('native-page').props.page, 1);
  await act(async () => { control().setActiveIndex(3); });
  await act(async () => { h.stop(); });
  assert.equal(h.Picker.type, h.original);
  assert.deepEqual(control().items.map(item => item.label), ['Emoji', 'GIFs', 'Stickers']);
  assert.equal(control().activeIndex.value, 1);
  assert.equal(renderer.root.findByType('native-page').props.page, 1);
  await act(async () => { renderer.unmount(); });
});

test('settings render failures show a readable native error instead of an empty page', async () => {
  const h = harness();
  mock.method(console, 'error', () => {});
  mock.method(h.storage, 'use', () => { throw new Error('Settings storage is unavailable'); });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.SettingsComponent, { api: { jsonStorage: h.storage } })); });
  assert.deepEqual(renderer.root.findAllByType('native-text').map(node => node.props.children),
    ['CatGIFs settings could not open', 'Settings storage is unavailable']);
  assert.equal(renderer.root.findByType('scroll-view').props.style.flex, 1);
  await act(async () => { renderer.unmount(); });
});

test('settings connect button opens approval, displays a manual link, and saves the authorized account', async () => {
  const h = harness();
  mock.timers.enable({ apis: ['setTimeout'] });
  const approvalURL = 'https://catgifs.marni.cc/settings/equicord?code=CAT-CODE';
  mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/device')) return Response.json({
      device_code: 'device-code', user_code: 'CAT-CODE', verification_uri_complete: approvalURL, expires_in: 600, interval: 5,
    });
    assert.ok(url.endsWith('/token'));
    return Response.json({ status: 'authorized', access_token: 'test-token' });
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.SettingsComponent, { api: { jsonStorage: h.storage } })); });
  const button = (text: string) => renderer.root.findAllByType('design-button').find(node => node.props.text === text);
  await act(async () => { button('Connect to CatGIFs').props.onPress(); });
  assert.deepEqual(h.openedURLs, [approvalURL]);
  assert.ok(button('Waiting for approval…').props.disabled);
  assert.ok(button('Open approval page'));
  assert.ok(renderer.root.findAllByType('design-text').some(node => node.props.children === approvalURL));
  await act(async () => { mock.timers.tick(5000); });
  assert.deepEqual(h.storage.cache.uploadConnection, { origin: 'https://catgifs.marni.cc', token: 'test-token' });
  assert.ok(button('Manage connected devices'));
  assert.equal(button('Open approval page'), undefined);
  await act(async () => { renderer.unmount(); });
});

test('a stalled connection request shows a timeout and enables retry', async () => {
  const h = harness();
  mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.SettingsComponent, { api: { jsonStorage: h.storage } })); });
  const button = (text: string) => renderer.root.findAllByType('design-button').find(node => node.props.text === text);
  await act(async () => { button('Connect to CatGIFs').props.onPress(); });
  assert.ok(button('Waiting for approval…').props.disabled);
  await act(async () => { mock.timers.tick(20_000); });
  assert.equal(button('Connect to CatGIFs').props.disabled, false);
  assert.ok(renderer.root.findAllByType('design-text').some(node => String(node.props.children).includes('took too long')));
  await act(async () => { renderer.unmount(); });
});

test('a failed browser launch leaves approval available and cancellation lets the user retry', async () => {
  const h = harness();
  mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ device_code: 'device-code', user_code: 'CAT-CODE',
      verification_uri_complete: 'https://catgifs.marni.cc/settings/equicord?code=CAT-CODE', expires_in: 600, interval: 5 });
  });
  mock.method(h.browser, 'openURL', async () => { throw new Error('No browser'); });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.SettingsComponent, { api: { jsonStorage: h.storage } })); });
  const button = (text: string) => renderer.root.findAllByType('design-button').find(node => node.props.text === text);
  await act(async () => { button('Connect to CatGIFs').props.onPress(); });
  assert.ok(button('Open approval page'));
  assert.ok(renderer.root.findAllByType('design-text').some(node => String(node.props.children).includes('Could not open your browser')));
  await act(async () => { button('Cancel connection').props.onPress(); });
  assert.equal(button('Connect to CatGIFs').props.disabled, false);
  assert.equal(button('Open approval page'), undefined);
  await act(async () => { mock.timers.tick(10_000); });
  assert.equal(requests, 1);
  await act(async () => { button('Connect to CatGIFs').props.onPress(); });
  assert.equal(requests, 2);
  await act(async () => { renderer.unmount(); });
});

test('media action sheets gain one upload action and restore their loader on disable', async () => {
  const h = harness();
  h.start();
  const NativeSheet = () => React.createElement('sheet', null,
    React.createElement('section', null, [React.createElement('action-sheet-row', { key: 'copy', label: 'Copy link' })]),
    React.createElement('section', null, [React.createElement('action-sheet-row', { key: 'save', label: 'Save' })]));
  for (const key of ['MessageLongPressActionSheet', 'GIFPickerActionSheet', 'MediaActionSheet', 'UnrelatedActionSheet']) {
    const props = { message: { attachments: [{ url: 'https://cdn.discordapp.com/cat.gif' }] } };
    const loaded = await h.sheets.openLazy(() => Promise.resolve({ default: NativeSheet }), key, props);
    assert.equal(loaded.props, props);
    let renderer;
    await act(async () => { renderer = create(React.createElement(loaded.module.default, props)); });
    assert.equal(renderer.root.findAllByType('action-sheet-row').filter(node => node.props.label === 'Upload to CatGIFs').length,
      key === 'UnrelatedActionSheet' ? 0 : 1);
    await act(async () => { renderer.unmount(); });
  }
  const pending = h.sheets.openLazy(Promise.resolve({ default: NativeSheet }), 'MessageLongPressActionSheet',
    { message: { attachments: [{ url: 'https://cdn.discordapp.com/cat.gif' }] } });
  h.stop();
  const loaded = await pending;
  let renderer;
  await act(async () => { renderer = create(React.createElement(loaded.module.default, loaded.props)); });
  assert.equal(renderer.root.findAllByType('action-sheet-row').length, 2);
  assert.equal(h.sheets.openLazy, h.originalOpenLazy);
  await act(async () => { renderer.unmount(); });
});

test('embedded grid measures its parent, preserves GIF proportions, searches, and sends directly', async () => {
  const h = harness();
  h.start();
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
  await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
  const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
  await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
  let list = renderer.root.findByType('native-gif-list');
  assert.equal(list.props.columnWidth, 180);
  assert.equal(list.props.resultItems[0].width / list.props.resultItems[0].height, 2);
  assert.equal(list.props.resultItems[1].width / list.props.resultItems[1].height, 0.5);
  assert.equal(renderer.root.findByType('icon-button').props.label, undefined);
  assert.equal(renderer.root.findByType('icon-button').props.accessibilityLabel, 'Refresh CatGIFs');
  const first = list.props.resultItems[0];
  await act(async () => { list.props.onPressGIF(first); });
  assert.deepEqual(h.sent, [{ channelId: 'channel-a', message: { content: 'https://catgifs.marni.cc/wide-cat.gif' },
    clearDraft: false, options: { location: 'gif_reply' } }]);
  assert.deepEqual(h.drafts, []);
  assert.equal(h.getClosed(), 1);
  h.storage.cache.keepPickerOpen = true;
  await act(async () => { list.props.onPressGIF(first.url); });
  assert.equal(h.getClosed(), 1);
  h.setChannel('different-chat');
  await act(async () => { list.props.onPressGIF(first); });
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.drafts, []);
  await act(async () => { renderer.root.findByType('search-input').props.onChange('portrait'); });
  list = renderer.root.findByType('native-gif-list');
  assert.deepEqual(list.props.resultItems.map(item => item.url), ['https://catgifs.marni.cc/portrait-cat.gif']);
  await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 800 } } }); });
  assert.equal(renderer.root.findByType('native-gif-list').props.columns, 4);
  await act(async () => { h.stop(); renderer.unmount(); });
});

test('expanding and collapsing uses the current scroll owner for native and fallback grids', async () => {
  for (const nativeListReady of [true, false]) {
    const h = harness({ nativeListReady });
    h.start();
    // The keyboard flag can stay true when its contents move into a sheet.
    const picker = React.createElement(h.Picker, { ...h.props, inPortalKeyboard: true });
    const tree = (sheet: object | null) => React.createElement(h.SheetContext.Provider, { value: sheet }, picker);
    let renderer;
    await act(async () => { renderer = create(tree(null)); });
    await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
    await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
    for (const sheet of [null, {}, null, {}]) {
      await act(async () => { renderer.update(tree(sheet)); });
      if (nativeListReady) {
        assert.equal(renderer.root.findByType('native-gif-list').props.inActionSheet, sheet !== null);
      } else {
        const list = renderer.root.findByType('flash-list');
        assert.equal(typeof list.props.renderScrollComponent, sheet ? 'function' : 'undefined');
        if (sheet) {
          let scroll;
          await act(async () => { scroll = create(React.createElement(list.props.renderScrollComponent, { testID: 'gif-scroll' })); });
          assert.equal(scroll.root.findByType('bottom-sheet-scroll-view').props.testID, 'gif-scroll');
          await act(async () => { scroll.unmount(); });
        }
      }
      assert.equal(renderer.root.findByType('segmented-control').props.state.activeIndex.value, 3);
    }
    if (!nativeListReady) {
      await act(async () => { h.finishNativeList(); });
      assert.equal(renderer.root.findByType('native-gif-list').props.inActionSheet, true);
    }
    await act(async () => { h.stop(); renderer.unmount(); });
  }
});

test('direct sending works without a chat input and never edits the draft', async () => {
  const h = harness();
  h.start();
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
  await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
  const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
  await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const list = renderer.root.findByType('native-gif-list');
  h.setInput(false);
  await act(async () => { list.props.onPressGIF(list.props.resultItems[0]); });
  assert.deepEqual(h.drafts, []);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].clearDraft, false);
  assert.equal(h.getClosed(), 0);
  await act(async () => { h.stop(); renderer.unmount(); });
});

test('unavailable sends, changed chats, and synchronous failures show an error without closing', async () => {
  for (const failure of ['unavailable', 'channel', 'throw']) {
    const h = harness({ messagesReady: failure !== 'unavailable' });
    h.start();
    h.setSendResult(() => { throw new Error('Send failed synchronously'); });
    let renderer;
    await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
    await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
    await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
    const list = renderer.root.findByType('native-gif-list');
    if (failure === 'channel') h.setChannel('different-chat');
    await act(async () => { list.props.onPressGIF(list.props.resultItems[0]); });
    assert.equal(h.sent.length, failure === 'throw' ? 1 : 0);
    assert.equal(h.getClosed(), 0);
    assert.deepEqual(h.drafts, []);
    const expectedError = failure === 'unavailable' ? /not ready to send/ :
      failure === 'channel' ? /active chat changed/ : /Could not send/;
    assert.ok(renderer.root.findAllByType('design-text').some(node => expectedError.test(String(node.props.children))));
    await act(async () => { h.stop(); renderer.unmount(); });
  }
});

test('selection closes immediately and finishing the send never closes a subsequent picker', async () => {
  for (const change of ['reopen', 'channel', 'disable']) {
    const h = harness();
    h.start();
    const { promise, resolve } = Promise.withResolvers<void>();
    h.setSendResult(() => promise);
    let renderer;
    await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
    await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
    await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
    const list = renderer.root.findByType('native-gif-list');
    await act(async () => {
      list.props.onPressGIF(list.props.resultItems[0]);
      assert.equal(h.getClosed(), 1);
    });
    assert.equal(h.sent.length, 1);
    if (change === 'disable') await act(async () => { h.stop(); });
    else {
      await act(async () => { renderer.unmount(); });
      if (change === 'channel') h.setChannel('different-chat');
      const props = change === 'channel' ? { ...h.props, channel: { id: 'different-chat' } } : h.props;
      await act(async () => { renderer = create(React.createElement(h.Picker, props)); });
      await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    }
    await act(async () => { resolve(); });
    assert.equal(h.getClosed(), 1);
    assert.deepEqual(h.errors, []);
    await act(async () => { h.stop(); renderer.unmount(); });
  }
});

test('keep picker open applies while sending and after success or asynchronous failure', async () => {
  for (const fails of [false, true]) {
    const h = harness();
    h.start();
    h.storage.cache.keepPickerOpen = true;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    h.setSendResult(() => promise);
    let renderer;
    await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
    await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
    await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
    const list = renderer.root.findByType('native-gif-list');
    await act(async () => { list.props.onPressGIF(list.props.resultItems[0]); });
    assert.equal(h.sent.length, 1);
    assert.equal(h.getClosed(), 0);
    // A setting change during the request must not trigger a delayed dismissal.
    h.storage.cache.keepPickerOpen = false;
    await act(async () => { if (fails) reject(new Error('Offline')); else resolve(); });
    assert.equal(h.getClosed(), 0);
    assert.equal(h.errors.length, fails ? 1 : 0);
    assert.equal(renderer.root.findAllByType('design-text').some(node => /Could not send/.test(String(node.props.children))), fails);
    await act(async () => { h.stop(); renderer.unmount(); });
  }
});

test('asynchronous failures after dismissal are caught without reopening or dismissing a new picker', async () => {
  for (const reopened of [false, true]) {
    const h = harness();
    h.start();
    const { promise, reject } = Promise.withResolvers<void>();
    const failure = new Error('Offline');
    h.setSendResult(() => promise);
    let renderer;
    await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
    await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
    await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
    const list = renderer.root.findByType('native-gif-list');
    await act(async () => { list.props.onPressGIF(list.props.resultItems[0]); });
    assert.equal(h.getClosed(), 1);
    await act(async () => { renderer.unmount(); });
    if (reopened) {
      await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
      await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
    }
    await act(async () => { reject(failure); });
    assert.deepEqual(h.errors, [['Could not send CatGIF', failure]]);
    assert.equal(h.getClosed(), 1);
    if (reopened) {
      assert.equal(renderer.root.findByType('segmented-control').props.state.activeIndex.value, 3);
      assert.equal(renderer.root.findAllByType('design-text').some(node => /Could not send/.test(String(node.props.children))), false);
    } else assert.equal(renderer.toJSON(), null);
    await act(async () => { h.stop(); renderer.unmount(); });
  }
});

test('first-use fallback has measured GIF heights and adopts the native list when it loads', async () => {
  const h = harness({ nativeListReady: false });
  h.start();
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.Picker, h.props)); });
  await act(async () => { renderer.root.findByType('segmented-control').props.state.setActiveIndex(3); });
  const panel = renderer.root.findAllByType('native-view').find(node => node.props.onLayout);
  await act(async () => { panel.props.onLayout({ nativeEvent: { layout: { width: 368 } } }); });
  const list = renderer.root.findByType('flash-list');
  assert.equal(list.props.numColumns, 2);
  assert.equal(list.props.drawDistance, 180);
  assert.equal(list.props.contentContainerStyle.paddingBottom, 64);
  let tile;
  await act(async () => { tile = create(list.props.renderItem({ item: list.props.data[0] })); });
  assert.equal(tile.root.findByType('native-image').props.style.width, 180);
  assert.equal(tile.root.findByType('native-image').props.style.height, 90);
  await act(async () => { h.finishNativeList(); });
  assert.equal(renderer.root.findByType('native-gif-list').props.resultItems.length, 2);
  await act(async () => { h.stop(); tile.unmount(); renderer.unmount(); });
});

test('deferred module callbacks cannot install a picker patch after disable', () => {
  const h = harness({ deferPicker: true });
  h.start();
  h.stop();
  h.finishPicker();
  assert.equal(h.Picker.type, h.original);
});

test('install ZIP contains the current manifest, production script, and client license', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/catgifs/manifest.json', import.meta.url), 'utf8'));
  const files = unzipSync(readFileSync(new URL(`../dist/${manifest.id}-${manifest.version}.zip`, import.meta.url)));
  assert.deepEqual(Object.keys(files).sort(), ['LICENSE', 'index.js', 'manifest.json']);
  assert.deepEqual(JSON.parse(strFromU8(files['manifest.json'])), manifest);
  assert.equal(strFromU8(files['index.js']), bundle);
  assert.match(strFromU8(files.LICENSE), /GNU GENERAL PUBLIC LICENSE/);
});
