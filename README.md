<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/banner-dark.png">
    <img src="assets/brand/banner-light.png" alt="snip-clip" width="640">
  </picture>
</p>

# snip-clip

**English** · [Português](README.pt-BR.md)

Cut one or many micro-clips from game recordings (OBS replays, NVIDIA app, anything FFmpeg reads) and export them ready to share — by default as **Discord-size files (≤ 20 MB)**.

> **Status:** early preview (**v0.1 beta**). See [ROADMAP.md](ROADMAP.md) and [spec.md](spec.md) (Portuguese).

## What it does (v0.1)

- Open a recording and see its audio tracks by name (OBS: *Game, Discord, Browser, Mic…*).
- Toggle tracks and change their volume while listening to the live mix.
- Mark several cuts with `I` / `O` and export each one, or join them into a montage.
- Size presets (Discord 20 MB, Nitro 50 / 500 MB, unlimited, lossless copy) that are **guaranteed** to stay under the limit.
- Copy the exported file to the clipboard, ready to paste into Discord.
- Windows, Linux and macOS · English and Portuguese.

## Install

Download the installer for your system from [Releases](https://github.com/NegentropyBeing/snip-clip/releases):

| System | File |
|---|---|
| Windows | `snip-clip_<version>_x64-setup.exe` |
| macOS (Intel and Apple Silicon) | `snip-clip_<version>_universal.dmg` |
| Linux | `snip-clip_<version>_amd64.AppImage` or `.deb` |

The installers are not code-signed yet:

- **Windows:** SmartScreen may warn. Choose *More info → Run anyway*.
- **macOS:** the first time, right-click the app in *Applications* and choose *Open*, or allow it in *System Settings → Privacy & Security*.

On first launch snip-clip looks for FFmpeg on your computer. If there is none, it offers to download a fixed, checksum-verified FFmpeg build into its own folder (about 30–200 MB depending on the system). You can also install FFmpeg yourself (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `sudo apt install ffmpeg`).

Exported clips go to `Videos/Clips` (macOS: `Movies/Clips`) and are copied to the clipboard, ready to paste into Discord. Both can be changed in *Settings* (`Ctrl+,`).

## Recording with OBS (Windows and Linux)

snip-clip can set OBS Studio up as an "instant replay" recorder whose files it handles best: the **replay profile**. The replay buffer is always on (save with **Alt+F10** by default), and every source goes to its own named audio track (*Mix, Game, Discord, Browser, Mic, System*), so you can drop Discord or the browser from a clip later.

Open *Settings → Recording* (`Ctrl+,`) with OBS closed, choose the options and press **Install**:

- **Basic:** replay length, replays folder, save hotkey, encoder (Automatic tests your graphics card) and the browsers whose sound goes to the Browser track.
- **Advanced:** memory limit, resolution, frame rate and quality.
- **Start:** optionally opens OBS with the profile when you sign in. It is off by default.

The same tab changes the profile later (your previous version is backed up in OBS's settings folder), opens OBS with it, and removes it. Track names follow the app's language. The *Open folder* setting in the General tab makes the Open video dialog start in the replays folder.

On **Linux**, OBS only hears its hotkeys while its window is focused on Wayland. On GNOME, snip-clip adds the save hotkey to GNOME's keyboard shortcuts. On other Wayland desktops the tab shows the command to bind (`snip-clip --save-replay`). Separate Discord and browser tracks need the [obs-pipewire-audio-capture](https://github.com/dimtpap/obs-pipewire-audio-capture) plugin; without it the profile records Mix, Mic and System. The replay profile is not available on macOS yet.

> [!IMPORTANT]
> **Windows: turn off NVIDIA Instant Replay (ShadowPlay) before using this profile.** Both use **Alt+F10** to save a replay, and running both keeps two replay buffers and two GPU encoders busy, doubling RAM use and encoder load. In the NVIDIA app, press **Alt+Z** and switch **Instant Replay** off, or pick another save hotkey.

## Privacy

snip-clip has **no telemetry**: no analytics, no usage data, no crash reports. It only goes online to download FFmpeg (after you confirm) and to check GitHub Releases for a new version.

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

## License

[GPL-3.0](LICENSE). FFmpeg is a separate program, downloaded at first run under its own license.
