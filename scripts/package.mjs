// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const manifest = await readFile(new URL('plugins/catgifs/manifest.json', root), 'utf8');
const { id, version, dist } = JSON.parse(manifest);
const script = await readFile(new URL('plugins/catgifs/build/js/index.js', root));
const license = await readFile(new URL('LICENSE', root));
await mkdir(new URL('dist/', root), { recursive: true });
const output = new URL(`dist/${id}-${version}.zip`, root);
await writeFile(output, zipSync({
  'manifest.json': strToU8(manifest),
  [dist.script]: script,
  LICENSE: license,
}));
console.log(`Packaged ${fileURLToPath(output)}`);
