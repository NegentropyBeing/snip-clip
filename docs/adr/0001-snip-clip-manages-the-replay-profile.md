# snip-clip manages the replay profile

From v0.2, snip-clip installs, reconfigures and removes the replay profile in OBS itself, from a Recording tab in Settings, instead of the Python scripts in `extras/obs/`, which are removed. The profile is what makes snip-clip's track handling useful (one named track per source), Python was the hardest part of installing it, and keeping two implementations of the same profile in step (source IDs, encoders, Wayland rules) would drift. Profile generation is pure TypeScript in `src/core`; the Rust backend only reads and writes OBS's files and detects the OBS install.

## Consequences

- snip-clip writes into another program's settings folder. It refuses to while OBS is running, because OBS rewrites its settings when it quits.
- On Wayland, where OBS cannot see hotkeys without focus, saving a replay goes through `snip-clip --save-replay` and OBS's WebSocket server, which snip-clip turns on (and off again on removal, only if it turned it on).
- snip-clip stays an app you open to edit: it does not run in the background to listen for the hotkey.
- No network: a missing OBS or Linux audio plugin is reported with install instructions, never downloaded.
