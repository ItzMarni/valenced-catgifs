// SPDX-License-Identifier: GPL-3.0-or-later
import { Design } from '@valenced/discord/design';
import { Component, useState } from 'react';
import { ScrollView, Text as NativeText } from 'react-native';
import { DEFAULT_ENDPOINT, getEndpoint } from './api';
import ConnectionSettings from './ConnectionSettings';
import type { PluginSettingsComponent } from '@valenced/plugins/types';
import type { ComponentProps, ReactNode } from 'react';

export interface Settings {
  apiEndpoint: string;
  keepPickerOpen: boolean;
  uploadConnection?: { origin: string; token: string } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  apiEndpoint: DEFAULT_ENDPOINT,
  keepPickerOpen: false,
};

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>;

class SettingsErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <NativeText style={{ color: '#ed4245', fontSize: 18 }}>CatGIFs settings could not open</NativeText>
      <NativeText selectable style={{ color: '#ed4245' }}>{this.state.error}</NativeText>
    </ScrollView>;
  }
}

export default function SettingsComponent(props: Props) {
  return <SettingsErrorBoundary><SettingsContent {...props} /></SettingsErrorBoundary>;
}

function SettingsContent({ api: { jsonStorage: storage } }: Props) {
  const settings = { ...DEFAULT_SETTINGS, ...storage.use() };
  const [endpoint, setEndpoint] = useState(settings.apiEndpoint);
  const [error, setError] = useState('');
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
      keyboardShouldPersistTaps="handled">
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
        <ConnectionSettings storage={storage} settings={settings} />
        <Design.Text variant="text-sm/normal" color="text-muted">
          Open the expression picker and choose CatGIFs beside Emoji, GIFs, and Stickers. Tap a GIF to send it immediately.
        </Design.Text>
    </ScrollView>
  );
}
