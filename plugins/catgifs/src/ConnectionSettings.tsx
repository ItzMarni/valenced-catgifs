// SPDX-License-Identifier: GPL-3.0-or-later
import { Design } from '@valenced/discord/design';
import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { connectAccount, submitGif, uploadBase } from './uploads';
import type { JsonStorage } from '@valenced/json-storage';
import type { Settings } from './settings';

export default function ConnectionSettings({ storage, settings }: { storage: JsonStorage<Settings>; settings: Settings }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [approval, setApproval] = useState<{ url: string; code: string } | null>(null);
  const [browserError, setBrowserError] = useState('');
  const request = useRef<AbortController | null>(null);
  const connected = settings.uploadConnection?.origin === settings.apiEndpoint && !!settings.uploadConnection.token;

  useEffect(() => {
    setBusy(false);
    setMessage('');
    setApproval(null);
    setBrowserError('');
    return () => { request.current?.abort(); request.current = null; };
  }, [settings.apiEndpoint]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const timer = setTimeout(() => controller.abort(), 10 * 60_000);
    try { await action(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'CatGIFs request failed.');
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        setApproval(null);
        if (controller.signal.aborted) setMessage('Request timed out. Please try again.');
      }
    }
  }

  async function openApproval(url: string) {
    setBrowserError('');
    try { await Linking.openURL(url); }
    catch {
      setBrowserError('Could not open your browser. Open the approval URL below in your browser and approve this device.');
    }
  }

  return <>
    <Design.Text variant="text-sm/normal" color="text-muted">
      {connected ? 'Connected to CatGIFs. Long-press an image or GIF message and choose Upload to CatGIFs.'
        : 'Connect your CatGIFs account to submit GIFs for review. Approve the connection in your browser.'}
    </Design.Text>
    {message ? <Design.Text variant="text-sm/normal" color="text-default">{message}</Design.Text> : null}
    {connected ? <>
      <Design.Button text="Manage connected devices" size="md" onPress={() => {
        void run(async () => { await Linking.openURL(new URL('/settings/equicord', uploadBase(settings.apiEndpoint)).href); });
      }} disabled={busy} />
      <Design.Button text="Remove local token" size="md" disabled={busy} onPress={() => {
        void run(async () => { await storage.set({ uploadConnection: null }); setMessage('Disconnected locally. Revoke this device on CatGIFs to invalidate its token.'); });
      }} />
      <Design.TextInput label="GIF or image URL" placeholder="https://…/cat.gif" value={url} onChange={setUrl} />
      <Design.Button text={busy ? 'Please wait…' : 'Upload to CatGIFs'} size="md" disabled={busy || !url.trim()} onPress={() => {
        void run(async signal => {
          setMessage('Uploading…');
          await submitGif(storage, url, signal);
          if (signal.aborted) return;
          setUrl('');
          setMessage('GIF submitted to CatGIFs for review.');
        });
      }} />
    </> : <Design.Button text={busy ? 'Waiting for approval…' : 'Connect to CatGIFs'} size="md" disabled={busy} onPress={() => {
      void run(async signal => {
        setMessage('Starting connection…');
        const base = uploadBase(settings.apiEndpoint);
        const token = await connectAccount(base, signal, async (url, code) => {
          if (signal.aborted) return;
          setApproval({ url, code });
          setMessage(`Approve this device in your browser. Your code is ${code}.`);
          await openApproval(url);
        });
        if (signal.aborted) return;
        await storage.set({ uploadConnection: { origin: base.origin, token } });
        setMessage('Connected. GIF uploads will be submitted for review.');
      });
    }} />}
    {busy && !connected ? <>
      {approval ? <>
        <Design.Button text="Open approval page" size="md" onPress={() => { void openApproval(approval.url); }} />
        <Design.Text variant="text-sm/normal" color="text-default" selectable>{approval.url}</Design.Text>
      </> : null}
      <Design.Button text="Cancel connection" size="md" onPress={() => {
        request.current?.abort();
        request.current = null;
        setBusy(false);
        setApproval(null);
        setBrowserError('');
        setMessage('Connection cancelled.');
      }} />
    </> : null}
    {browserError && approval ? <Design.Text variant="text-sm/normal" color="text-feedback-critical">{browserError}</Design.Text> : null}
  </>;
}
