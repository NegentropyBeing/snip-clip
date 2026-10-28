# Roadmap

## v0.1 — in progress

Scope: [spec.md](spec.md).

- [x] Core engine: presets, size budget, resolution ladder, encoder choice, FFmpeg commands, overshoot retry
- [x] Unit tests + integration tests against real FFmpeg
- [x] Rust backend: FFmpeg detection (system `PATH`), process runner with progress and cancel, encoder probe
- [ ] FFmpeg download on first run (pinned version, SHA-256)
- [x] Media probe (ffprobe → `MediaInfo`), per-track audio extraction for preview
- [x] UI: player, live multi-track mixer, timeline with waveform, cut list, keyboard shortcuts with hints
- [x] Export queue, presets, auto-save per video, recent files, drag and drop
- [ ] Settings screen (export folder, encoder, language)
- [x] "Show in folder" after export
- [ ] Copy exported file to clipboard (Windows / macOS / Linux)
- [x] i18n (en, pt-BR) and system theme
- [x] Preview proxy (H.264 540p) when the WebView cannot decode the source
- [x] Logo, app icon and palette
- [ ] Update check against GitHub Releases
- [ ] CI: tests on push, installers for the 3 OSes on tags

## Later

| Feature | Area |
|---|---|
| Vertical 9:16 crop, slow motion, text/captions, fades | Editing |
| Discord **webhook** upload ("destinations" are planned in the v0.1 design) | After export |
| Per-cut track and volume overrides | Mixing |
| Montage transitions (fade / crossfade) | Montage |
| Folder **gallery** with thumbnails | Opening |
| **GIF** and WebM output | Output |
| Per-track waveforms | Timeline |
| Auto-update (Tauri updater) | Distribution |
| Stream-copy montage (needs temporary segments) | Export |

Out of scope: batch library compression — that is a separate project.
