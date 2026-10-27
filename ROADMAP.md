# Roadmap

## v0.1 — in progress

Scope: [spec.md](spec.md).

- [x] Core engine: presets, size budget, resolution ladder, encoder choice, FFmpeg commands, overshoot retry
- [x] Unit tests + integration tests against real FFmpeg
- [ ] Rust backend: FFmpeg detection/download (SHA-256), process runner with progress and cancel, encoder probe
- [ ] Media probe (ffprobe → `MediaInfo`), per-track audio extraction for preview
- [ ] UI: player, live multi-track mixer, timeline with waveform, cut list, keyboard shortcuts with hints
- [ ] Export queue, presets, settings, auto-save per video
- [ ] Copy exported file to clipboard (Windows / macOS / Linux) + "Show in folder"
- [ ] i18n (en, pt-BR) and system theme
- [ ] Preview proxy (H.264 540p) when the WebView cannot decode the source
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
| Code signing (Windows / macOS) | Distribution |
| Stream-copy montage (needs temporary segments) | Export |

Out of scope: batch library compression — that is a separate project.
