// SPDX-License-Identifier: GPL-3.0-or-later
import Page from '@valenced/components/Page';
import { Design } from '@valenced/discord/design';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { DEFAULT_ENDPOINT, getEndpoint } from './api';
import type { PluginSettingsComponent } from '@valenced/plugins/types';
import type { ComponentProps } from 'react';

export interface Settings {
  apiEndpoint: string;
  keepPickerOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiEndpoint: DEFAULT_ENDPOINT,
  keepPickerOpen: false,
};

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>;

export default function SettingsComponent({ api: { jsonStorage: storage } }: Props) {
  const settings = { ...DEFAULT_SETTINGS, ...storage.use() };
  const [endpoint, setEndpoint] = useState(settings.apiEndpoint);
  const [error, setError] = useState('');
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Page>
        <Design.TextInput
          label="API Base URL"
          placeholder={DEFAULT_ENDPOINT}
          value={endpoint}
          status={error ? 'error' : 'default'}
          errorMessage={error || undefined}
          onChange={setEndpoint}
        />
        <Design.Button text="Save endpoint" size="md" onPress={() => {
          const url = getEndpoint(endpoint);
          if (!url) {
            setError('Enter a valid HTTP or HTTPS URL without login credentials.');
            return;
          }
          setError('');
          setEndpoint(url.origin);
          void storage.set({ apiEndpoint: url.origin });
        }} />
        <Design.TableRowGroup>
          <Design.TableSwitchRow
            label="Keep picker open"
            subLabel="Keep browsing after sending a GIF."
            value={settings.keepPickerOpen}
            onValueChange={value => { void storage.set({ keepPickerOpen: value }); }}
          />
        </Design.TableRowGroup>
        <Design.Text variant="text-sm/normal" color="text-muted">
          Open the expression picker and choose CatGIFs beside Emoji, GIFs, and Stickers. Tap a GIF to send it immediately.
        </Design.Text>
      </Page>
    </ScrollView>
  );
}
