// SPDX-License-Identifier: GPL-3.0-or-later
import { getStore } from '@valenced/discord/flux';
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders';
import { getModules } from '@valenced/modules/finders';
import { withProps } from '@valenced/modules/finders/filters';
import { instead } from '@valenced/patcher';
import ExtendedExpressionPicker from './ExpressionPicker';
import SettingsComponent, { DEFAULT_SETTINGS } from './settings';
import type { NativePicker, PickerRuntime } from './ExpressionPicker';
import type { Settings } from './settings';

const PICKER_PATH = 'modules/expression_picker/native/ExpressionPicker.tsx';

interface ChatInputs {
  getBestActiveInputForChannelId(channelId: string): {
    closeCustomKeyboard(): void;
  } | undefined;
}

interface MessageActions {
  sendMessage(channelId: string, message: { content: string }, clearDraft: boolean,
    options: { location: string }): unknown;
  receiveMessage: unknown;
}

interface SelectedChannel { getChannelId(): string | undefined }

export default plugin<{ jsonStorage: Settings }>({
  jsonStorage: { load: true, default: DEFAULT_SETTINGS },
  SettingsComponent,
  init({ cleanup, jsonStorage: storage, logger }) {
    let inputs: ChatInputs | undefined;
    let messages: MessageActions | undefined;
    let selectedChannel: SelectedChannel | undefined;
    const listeners = new Set<() => void>();
    const runtime: PickerRuntime = {
      active: true,
      storage,
      resetters: new Set(),
      subscribe(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      async select(channelId, url) {
        if (!runtime.active) return 'CatGIFs has been disabled.';
        if (!channelId || selectedChannel?.getChannelId() !== channelId) return 'The active chat changed. Reopen CatGIFs in your chat.';
        if (!messages) return 'Discord is not ready to send messages. Close the picker and try again.';
        try {
          await messages.sendMessage(channelId, { content: url }, false, { location: 'gif_reply' });
        } catch (error) {
          logger.error('Could not send CatGIF', error);
          return 'Could not send this GIF. Please try again.';
        }
        if (runtime.active && selectedChannel?.getChannelId() === channelId &&
            !(storage.cache?.keepPickerOpen ?? DEFAULT_SETTINGS.keepPickerOpen)) {
          try { inputs?.getBestActiveInputForChannelId(channelId)?.closeCustomKeyboard(); }
          catch (error) { logger.warn('Could not close the expression picker', error); }
        }
        return null;
      },
    };

    cleanup(() => {
      runtime.active = false;
      for (const reset of runtime.resetters) reset();
      for (const listener of listeners) listener();
    });

    cleanup(
      getStore<SelectedChannel>('SelectedChannelStore', store => { selectedChannel = store; }),
      getModules(withProps<ChatInputs>('getBestActiveInputForChannelId'), module => { inputs = module; }),
      getModules(withProps<MessageActions>('sendMessage', 'receiveMessage'), module => { messages = module; }),
      getModuleWithImportedPath<{ default: { type: NativePicker } }>(PICKER_PATH, ({ default: Picker }) => {
        if (!runtime.active) return;
        if (typeof Picker?.type !== 'function') {
          logger.error('The native expression picker has changed. CatGIFs could not add its tab.');
          return;
        }
        cleanup(instead(Picker, 'type', ([nativeProps], Native) =>
          <ExtendedExpressionPicker Native={Native} nativeProps={nativeProps} runtime={runtime} />));
      }),
    );
  },
});
