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

## Recording with OBS (Windows)

[`extras/obs/`](extras/obs) sets OBS Studio up as an "instant replay" recorder whose files clip-snip handles best: the replay buffer is always on, and every source goes to its own named audio track, so you can drop Discord or the browser from a clip later.

| Track | Name | Contents |
|---|---|---|
| 1 | Mix | Game + Discord + browser + mic |
| 2 | Game | Game capture audio |
| 3 | Discord | Discord app only |
| 4 | Browser | The browsers you choose |
| 5 | Mic | Default microphone |
| 6 | System (all) | Everything the PC plays (fallback) |

1. Install [OBS Studio](https://obsproject.com/) and [Python 3](https://www.python.org/), and close OBS.
2. Create the profile and scene collection **clip-snip Replay** (existing ones with that name are backed up first):

   ```sh
   python extras/obs/obs-setup.py                    # 3-minute buffer, NVENC AV1, your screen size
   python extras/obs/obs-setup.py --buffer 300       # 5-minute buffer
   python extras/obs/obs-setup.py --help             # output folder, size, fps, encoder, browsers, language
   ```

3. Start OBS with `extras/obs/obs-replay.cmd` (put a shortcut in your Startup folder to have it always running). Press **Alt+F10** to save the last minutes to `Videos/OBS Replays`.

**Buffer length.** `--buffer` sets how many seconds a saved replay covers; the memory limit is sized to match (about 0.8 GB of RAM per minute at the peak bitrate). Both can also be changed in OBS under *Settings → Output → Replay Buffer* (*Maximum Replay Time* and *Maximum Memory*). Whichever limit is hit first wins, so raise both together.

**Encoders.** The default, `nvenc-av1`, needs an NVIDIA RTX 40 or newer. Use `--encoder nvenc-hevc` or `nvenc-h264` on older NVIDIA cards and `x264` (CPU) otherwise; AMD and Intel encoders can be picked in OBS afterwards.

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
| `extras/obs/` | Optional OBS profile setup and launcher for recording replays (Windows) |

## License

[GPL-3.0](LICENSE). FFmpeg is a separate program, downloaded at first run under its own license.
