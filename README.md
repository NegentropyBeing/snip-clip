# clip-snip

Cut one or many micro-clips from game recordings (OBS replays, NVIDIA app, anything FFmpeg reads) and export them ready to share — by default as **Discord-size files (≤ 20 MB)**.

> **Status:** early development, targeting **v0.1**. Not usable yet. See [spec.md](spec.md) (Portuguese) and [ROADMAP.md](ROADMAP.md).

## What it will do (v0.1)

- Open a recording and see its audio tracks by name (OBS: *Game, Discord, Browser, Mic…*).
- Toggle tracks and change their volume while listening to the live mix.
- Mark several cuts with `I` / `O` and export each one, or join them into a montage.
- Size presets (Discord 20 MB, Nitro 50 / 500 MB, unlimited, lossless copy) that are **guaranteed** to stay under the limit.
- Copy the exported file to the clipboard, ready to paste into Discord.
- Windows, Linux and macOS · English and Portuguese.

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

## License

[GPL-3.0](LICENSE). FFmpeg is a separate program, downloaded at first run under its own license.
