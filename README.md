<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/banner-dark.png">
    <img src="assets/brand/banner-light.png" alt="clip-snip" width="640">
  </picture>
</p>

# clip-snip

Cut one or many micro-clips from game recordings (OBS replays, NVIDIA app, anything FFmpeg reads) and export them ready to share — by default as **Discord-size files (≤ 20 MB)**.

> **Status:** early preview (**v0.1.0-beta.1**, Windows). It needs **FFmpeg on your `PATH`** for now — the in-app download, clipboard copy and settings screen are still to come. See [ROADMAP.md](ROADMAP.md) and [spec.md](spec.md) (Portuguese).

## What it will do (v0.1)

- Open a recording and see its audio tracks by name (OBS: *Game, Discord, Browser, Mic…*).
- Toggle tracks and change their volume while listening to the live mix.
- Mark several cuts with `I` / `O` and export each one, or join them into a montage.
- Size presets (Discord 20 MB, Nitro 50 / 500 MB, unlimited, lossless copy) that are **guaranteed** to stay under the limit.
- Copy the exported file to the clipboard, ready to paste into Discord.
- Windows, Linux and macOS · English and Portuguese.

## Recording with OBS (Windows)

[`extras/obs/`](extras/obs) sets OBS Studio up as an "instant replay" recorder whose files clip-snip handles best: the replay buffer is always on (save with **Alt+F10**), and every source goes to its own named audio track (*Mix, Game, Discord, Browser, Mic, System*), so you can drop Discord or the browser from a clip later.

> [!IMPORTANT]
> **Turn off NVIDIA Instant Replay (ShadowPlay) before using this profile.** Both use **Alt+F10** to save a replay, and running both keeps two replay buffers and two GPU encoders busy, doubling RAM use and encoder load. In the NVIDIA app, press **Alt+Z** and switch **Instant Replay** off.

**[How to install and turn on the OBS profile →](extras/obs/README.md)**: requirements, options (buffer length, encoder, output folder, browsers…), starting it with Windows, and how to undo it.

## Privacy

clip-snip has **no telemetry**: no analytics, no usage data, no crash reports. It only goes online to download FFmpeg (after you confirm) and to check GitHub Releases for a new version.

## Development

Requirements: Node 20+, pnpm, Rust (stable), FFmpeg on `PATH` for integration tests, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev            # run the app
pnpm test                 # unit tests (core)
pnpm test:integration     # runs real FFmpeg exports on synthetic clips
pnpm typecheck
```

### Layout

| Path | Purpose |
|---|---|
| `src/core/` | Platform-independent engine: presets, bitrate/size planning, FFmpeg command building, export retry loop |
| `src/` | React UI |
| `src-tauri/` | Rust backend: FFmpeg provisioning, process execution, clipboard, persistence |
| `tests/` | Integration tests against a real FFmpeg |
| `assets/brand/` | Logo: app icon source, badge and scissors SVGs, README banners |
| `extras/obs/` | Optional OBS profile setup and launcher for recording replays (Windows) |

## License

[GPL-3.0](LICENSE). FFmpeg is a separate program, downloaded at first run under its own license.
