# OBS replay profile — how to install and use

**English** · [Português](README.pt-BR.md)

This sets OBS Studio up as an always-on "instant replay" recorder on Windows and Linux: the last few minutes are kept in memory and saved to a file when you press **Alt+F10**. Every audio source gets its own named track, so in snip-clip you can drop Discord or the browser from a clip, or turn your mic down.

| Track | Name | Contents |
|---|---|---|
| 1 | Mix | Game + Discord + browser + mic |
| 2 | Game | Game capture audio |
| 3 | Discord | Discord app only |
| 4 | Browser | The browsers you choose |
| 5 | Mic | Default microphone |
| 6 | System (all) | Everything the PC plays (fallback when a source is missed) |

The steps below are for Windows. On Linux, follow them with the changes in [Linux](#linux).

## 1. Before you start

- **Install OBS Studio** from [obsproject.com](https://obsproject.com/), or run `winget install OBSProject.OBSStudio`.
- **Install Python 3** from [python.org](https://www.python.org/downloads/) (tick *Add python.exe to PATH*), or run `winget install Python.Python.3.12`.
- **Turn off NVIDIA Instant Replay (ShadowPlay).** It also saves with Alt+F10, and running both doubles RAM and GPU encoder use. In the NVIDIA app press **Alt+Z** and switch **Instant Replay** off. With GeForce Experience the setting is in the same Alt+Z overlay.
- **Close OBS.** It overwrites its settings when it quits, so changes made while it runs are lost.

## 2. Get the files

Download this repository (green **Code** button → **Download ZIP**) and extract it, or clone it with git. You only need the files in `extras/obs/`.

## 3. Create the profile

Open a terminal in `extras/obs/` (in Explorer: right-click the folder → *Open in Terminal*) and run:

```sh
python obs-setup.py
```

If `python` opens the Microsoft Store, use `py obs-setup.py` instead.

That creates a profile and a scene collection, both named **snip-clip Replay**, with:

- a 3-minute buffer, saved with **Alt+F10**
- your main screen's resolution at 60 fps
- the best encoder your PC supports, found by a quick test: NVENC AV1, then HEVC, then H.264, otherwise x264 on the CPU (constant quality 28)
- replays saved as MKV to `Videos\OBS Replays` (MKV keeps the track names, MP4 drops them)
- Chrome and Firefox on the Browser track
- track names in your Windows display language (English or Portuguese)

Your other OBS profiles are not touched. If a **snip-clip Replay** profile already exists, it is backed up to `%APPDATA%\obs-studio\basic\backup-<date>\` first.

### Options

Combine any of these:

| Option | Example | Default |
|---|---|---|
| `--buffer` seconds kept | `--buffer 300` (5 min) | `180` |
| `--memory` RAM limit in MB | `--memory 4096` | sized for `--buffer` |
| `--output` folder | `--output "D:/Replays"` | `~/Videos/OBS Replays` |
| `--size` canvas and video size | `--size 1920x1080` | main screen |
| `--fps` | `--fps 30` | `60` |
| `--encoder` | `nvenc-av1`, `nvenc-hevc`, `nvenc-h264`, `x264` (Linux also `vaapi-av1`, `vaapi-hevc`, `vaapi-h264`) | `auto` |
| `--quality` lower = better, bigger | `--quality 24` | `28` |
| `--browser` (repeat for several) | `--browser firefox --browser zen` | `chrome`, `firefox` |
| `--lang` track and source names | `--lang pt` | system language |
| `--app-audio` (Linux) Game, Discord and Browser tracks | `on`, `off` | `auto`: on when the plugin is installed |

`auto` tests your GPU with FFmpeg when it is installed, otherwise reads the NVIDIA card name. To pick one yourself:

- **`nvenc-av1`** needs an NVIDIA RTX 40 series or newer.
- **`nvenc-hevc`** or **`nvenc-h264`** for older NVIDIA cards.
- **`x264`** (CPU) for any PC.
- **AMD or Intel GPU:** create the profile with `x264`, then pick your GPU's encoder in OBS under *Settings → Output → Recording*.

Example: 5 minutes, 1080p, replays on drive D, Firefox and Zen, Portuguese track names:

```sh
python obs-setup.py --buffer 300 --size 1920x1080 --output "D:/Replays" --browser firefox --browser zen --lang pt
```

Run the script again any time to change settings. The previous version is backed up each time.

## 4. Turn it on

### Every time, automatically (recommended)

`obs-replay.cmd` starts OBS with this profile and the replay buffer already running.

1. Press **Win+R**, type `shell:startup`, and press Enter.
2. In the folder that opens, right-click → *New → Shortcut* and point it at `obs-replay.cmd`.

OBS will now start with Windows, ready to save replays. You can also double-click `obs-replay.cmd` to start it now.

### By hand, inside OBS

1. **Profile** menu → **snip-clip Replay**.
2. **Scene Collection** menu → **snip-clip Replay**.
3. Click **Start Replay Buffer** in the *Controls* panel.

## 5. Check that it works

1. Play something for a few seconds: a game, a Discord call, a video in the browser.
2. Press **Alt+F10**. A file named `Replay <date> <time>.mkv` appears in the output folder.
3. Open it in snip-clip: the tracks should be listed by name and each one should play only its own audio.

To see which source goes to which track, go to OBS → *Edit → Advanced Audio Properties*.

## Notes

- **Windowed and borderless games.** The *Game* source captures fullscreen games. Others fall back to the *Screen* source behind it, which records the whole monitor. Their sound still lands on track 6, *System*.
- **Longer replays.** Raise `--buffer`; the memory limit grows to match, about 0.8 GB of RAM per minute at the peak bitrate. In OBS you can also change *Settings → Output → Replay Buffer → Maximum Replay Time* and *Maximum Memory*. Whichever limit is reached first wins, so raise both together.
- **Different hotkey.** Change it in OBS under *Settings → Hotkeys → Save Replay*.
- **Undo.** Pick another profile and scene collection in OBS. To restore a previous version, close OBS and copy the files back from `%APPDATA%\obs-studio\basic\backup-<date>\`:
  - the `profile-snip-clip Replay` folder goes to `profiles\snip-clip Replay`;
  - the `.json` file goes to `scenes\`.

## Linux

Everything above applies, with these changes. You need OBS 31 or newer and PipeWire, on X11 or Wayland.

### Before you start

- **Install OBS Studio, Python 3 and FFmpeg** from your distribution (FFmpeg is only used to test the GPU encoders), or OBS from Flathub: `flatpak install flathub com.obsproject.Studio`. If both are installed, the script sets up the native OBS.
- **Install the [obs-pipewire-audio-capture](https://github.com/dimtpap/obs-pipewire-audio-capture) plugin** for the Game, Discord and Browser tracks. OBS on Linux cannot capture one app's audio by itself.
  - Flatpak OBS: `flatpak install flathub com.obsproject.Studio.Plugin.PipeWireAudioCapture`
  - Native OBS: extract the archive from the plugin's latest release into `~/.config/obs-studio/plugins/`.

  Without it the profile still works, with three tracks: Mix (system + mic), Mic and System.

### Create the profile

```sh
cd extras/obs
python3 obs-setup.py
```

What changes from Windows:

- **Screen.** X11 uses *Screen Capture (XSHM)* on the first screen. Wayland uses *Screen Capture (PipeWire)*: the first time OBS starts it asks which screen to share. Pick it and allow it to be remembered.
- **Game track.** There is no game capture on Linux, so the *Game* track gets every app **except** Discord, the browsers and OBS. Notification sounds from other apps land there too.
- **Encoder.** `auto` also tests VAAPI (AMD and Intel GPUs) after NVENC: AV1, then HEVC, then H.264. VAAPI uses constant QP (`--quality` minus 5).
- **Replays** go to your Videos folder (`xdg-user-dir VIDEOS`) under `OBS Replays`.
- **Backups** go to `~/.config/obs-studio/basic/backup-<date>/`, or `~/.var/app/com.obsproject.Studio/config/obs-studio/basic/backup-<date>/` for the Flatpak.

### Saving with Alt+F10 on Wayland

On Wayland, OBS only sees its hotkeys while its window has focus, so Alt+F10 does nothing during a game. On X11 it works as on Windows.

On Wayland, `obs-setup.py` turns on OBS's built-in WebSocket server (port 4455, with a password it generates; an existing password is kept). `obs-save-replay.py` uses it to save the replay and shows a notification. Bind it to Alt+F10 in your desktop:

- **GNOME:** *Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts → +*. Command: `python3 /full/path/to/extras/obs/obs-save-replay.py`. GNOME already uses Alt+F10 to maximize windows: free it under *Windows → Toggle maximization state*, or pick another key.
- **KDE Plasma:** *System Settings → Keyboard → Shortcuts → Add New → Command or Script*, same command.

The server listens on all network interfaces; the password protects it. To turn it off, go to OBS → *Tools → WebSocket Server Settings*.

### Turn it on every time

`obs-replay.sh` starts OBS (native, else Flatpak) with this profile and the replay buffer running. To start it when you log in, run this in `extras/obs/`:

```sh
chmod +x obs-replay.sh
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/snip-clip-replay.desktop <<EOF
[Desktop Entry]
Type=Application
Name=OBS replay (snip-clip)
Exec="$PWD/obs-replay.sh"
EOF
```

You can also run `./obs-replay.sh` to start it now.
