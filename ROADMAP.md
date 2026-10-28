# Roadmap

## v0.1 — done

Scope: [spec.md](spec.md). Tested on Windows through `v0.1.0-beta.3`; the remaining platform tests were dropped, and the app ships unsigned.

- [x] Core engine: presets, size budget, resolution ladder, encoder choice, FFmpeg commands, overshoot retry
- [x] Unit tests + integration tests against real FFmpeg
- [x] Rust backend: FFmpeg detection (system `PATH`), process runner with progress and cancel, encoder probe
- [x] FFmpeg download on first run (pinned version, SHA-256)
- [x] Media probe (ffprobe → `MediaInfo`), per-track audio extraction for preview
- [x] UI: player, live multi-track mixer, timeline with waveform, cut list, keyboard shortcuts with hints
- [x] Export queue, presets, auto-save per video, recent files, drag and drop
- [x] Settings screen (export folder, default preset, encoder, language, theme, updates)
- [x] "Show in folder" after export
- [x] Copy exported file to clipboard (Windows / macOS / Linux)
- [x] i18n (en, pt-BR) and system theme
- [x] Preview proxy (H.264 540p) when the WebView cannot decode the source
- [x] Logo, app icon and palette
- [x] Update check against GitHub Releases
- [x] CI: tests on push, installers for the 3 OSes on tags
- [x] Per-track waveforms on the timeline
- [x] First CI run and a test release (`v0.1.0-beta.3`) with installers for the 3 OSes
- [x] Windows: acceptance criteria in [spec.md §12](spec.md#12-critérios-de-aceite-da-v01), including pasting into Discord

## v0.2 — Recording tab (replay profile)

Scope: [spec.md §16](spec.md#16-v02--gravação-perfil-de-replay), [ADR 0001](docs/adr/0001-snip-clip-manages-the-replay-profile.md).

- [x] Core: replay profile generation in TypeScript (OBS `basic.ini`, encoder settings, scene collection) with tests, reading back an installed profile
- [x] Backend: find OBS (Windows; Linux native or Flatpak), tell if it is running, read and write its files, backups, Linux audio plugin check
- [x] Settings split into General and Recording tabs
- [x] Recording tab: status, install / reconfigure (basic + Advanced), remove, open OBS now, start at login (off by default)
- [x] Missing OBS and missing Linux audio plugin: install instructions, nothing downloaded
- [x] Save-replay hotkey: OBS on Windows and X11, GNOME custom shortcut on Wayland, instructions elsewhere
- [x] `snip-clip --save-replay` through OBS's WebSocket server, without opening the window
- [x] Open folder setting (follows the replays folder by default)
- [x] Remove `extras/obs/` and point the READMEs to the Recording tab
- [ ] Acceptance criteria in [spec.md §16.5](spec.md#165-critérios-de-aceite-da-v02)

## Later

| Feature | Area |
|---|---|
| Vertical 9:16 crop, slow motion, text/captions, fades | Editing |
| Discord **webhook** upload ("destinations" are planned in the v0.1 design) | After export |
| Per-cut track and volume overrides | Mixing |
| Montage transitions (fade / crossfade) | Montage |
| Folder **gallery** with thumbnails | Opening |
| **GIF** and WebM output | Output |
| Lock export resolution / fps by hand (spec §6.2) | Export |
| HDR → SDR: check the tone mapping against a reference player; gamut mapping for very saturated colors | Export |
| Auto-update (Tauri updater) | Distribution |
| Stream-copy montage (needs temporary segments) | Export |
| Replay profile on macOS (ScreenCaptureKit, VideoToolbox) | Recording |
| Register the save-replay hotkey on KDE Plasma | Recording |

Out of scope: batch library compression — that is a separate project.
