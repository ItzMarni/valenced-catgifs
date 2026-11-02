// SPDX-License-Identifier: GPL-3.0-or-later
import { Design } from '@valenced/discord/design';
import { getModules } from '@valenced/modules/finders';
import { withProps } from '@valenced/modules/finders/filters';
import { instead } from '@valenced/patcher';
import { cloneElement, isValidElement, useState } from 'react';
import { mediaSource, submitGif } from './uploads';
import type { JsonStorage } from '@valenced/json-storage';
import type { ReactNode } from 'react';
import type { Settings } from './settings';

type Sheet = { default: ((props: Record<string, unknown>) => ReactNode) | { type: (props: Record<string, unknown>) => ReactNode } };
interface ActionSheets {
  hideActionSheet(key: string): void;
  openLazy(loader: Promise<Sheet> | (() => Promise<Sheet>), key: string, props: Record<string, unknown>, ...rest: unknown[]): unknown;
}

function addUploadRow(node: ReactNode, row: ReactNode): ReactNode {
  let added = false;
  function visit(node: ReactNode): ReactNode {
    if (added) return node;
    if (Array.isArray(node)) {
      if (node.some(child => isValidElement(child) && child.type === Design.ActionSheetRow)) {
        added = true;
        return [...node, row];
      }
      return node.map(visit);
    }
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;
    if (isValidElement(node.props.children) && node.props.children.type === Design.ActionSheetRow) {
      added = true;
      return cloneElement(node, undefined, node.props.children, row);
    }
    if (node.props.children == null) return node;
    const children = visit(node.props.children);
    return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
  }
  return visit(node);
}

export function installUploadMenu(storage: JsonStorage<Settings>, cleanup: (...items: (() => void)[]) => void) {
  let active = true;
  const requests = new Set<AbortController>();
  cleanup(() => { active = false; for (const request of requests) request.abort(); });

  function UploadRow({ source }: { source: string }) {
    const [label, setLabel] = useState('Upload to CatGIFs');
    const [busy, setBusy] = useState(false);
    return <Design.ActionSheetRow label={label} disabled={busy} onPress={async () => {
      if (!active || busy) return;
      const controller = new AbortController();
      requests.add(controller);
      setBusy(true);
      setLabel('Uploading to CatGIFs…');
      try {
        await submitGif(storage, source, controller.signal);
        if (active) setLabel('GIF submitted to CatGIFs for review.');
      } catch (error) {
        if (active) setLabel(error instanceof Error ? error.message : 'Could not upload this GIF.');
      } finally {
        requests.delete(controller);
        if (active) setBusy(false);
      }
    }} />;
  }

  cleanup(getModules(withProps<ActionSheets>('openLazy', 'hideActionSheet'), sheets => {
    if (!active) return;
    cleanup(instead(sheets, 'openLazy', ([loader, key, props, ...rest], original) => {
      if (!active || !/^(Message|GIF|Image|Media).*ActionSheet$/i.test(key)) {
        return original(loader, key, props, ...rest);
      }
      const source = mediaSource(props ?? {});
      if (!source) return original(loader, key, props, ...rest);
      const extend = (module: Sheet): Sheet => {
        const Native = typeof module.default === 'function' ? module.default : module.default?.type;
        if (typeof Native !== 'function') return module;
        return { ...module, default: nativeProps => {
          const tree = Native(nativeProps);
          return active ? addUploadRow(tree, <UploadRow key="catgifs-upload" source={source} />) : tree;
        } };
      };
      return original(typeof loader === 'function' ? () => loader().then(extend) : loader.then(extend), key, props, ...rest);
    }));
  }));
}
