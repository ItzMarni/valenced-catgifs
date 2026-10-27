# CatGIFs for Valenced

Browse and search CatGIFs from Discord's expression picker on Android. Tap a GIF to send it to the current chat.

> [!IMPORTANT]
> This project is AI-generated with OpenAI Codex. I cannot reliably review outside code contributions. Please open an issue for bugs or suggestions instead of opening a pull request.

## Browse CatGIFs

Open Discord's expression picker and choose **CatGIFs** beside **Emoji**, **GIFs**, and **Stickers**. Search for a GIF and tap it to send. Any text already in your message draft stays there.

CatGIFs uses Discord's native GIF results grid, matching the layout and scrolling of favorites. The refresh icon reloads the library. Enable **Keep picker open** in the plugin settings to keep browsing after sending a GIF.

The **API Base URL** setting defaults to `https://catgifs.marni.cc`; the plugin loads the GIF library from `/api/gifs` on that server. Search matches GIF filenames.

## Install

Download the plugin ZIP from [Releases](https://github.com/ItzMarni/valenced-catgifs/releases) and transfer it to your device. In **Settings > Valenced > Plugins**, open the settings gear and choose **Install from file**. Enable CatGIFs after installing. Reload Discord after installing an updated build.

## Scope and support

This repository contains the open-source client plugin, licensed under GPL-3.0-or-later. The CatGIFs API and website are closed source and are not included here.

The plugin targets Valenced on Android. This project is not affiliated with or supported by Valenced or Discord. Please do not contact their support teams or communities about this plugin. Plugin-specific bug reports can be opened here, but support and compatibility fixes are not guaranteed.

## Development

I develop this on NixOS, and these instructions cover my Nix setup. If you use Windows or another environment, you are welcome to adapt them, but figuring out your setup is on you; I do not provide platform-specific setup or troubleshooting.

```sh
nix develop
bun install --frozen-lockfile
bun run build
```

The build uses Valenced's CLI and writes the plugin ZIP to `dist/`. Run `bun run typecheck` and `bun run test` to check your changes.
