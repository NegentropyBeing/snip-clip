"""Creates an OBS Studio profile and scene collection, "snip-clip Replay", tuned for snip-clip (Windows and Linux).

Replay buffer always on, one audio track per source (game, Discord, browser, mic, system),
saved with a hotkey. Close OBS before running. The current profile and collection with the
same name, if any, are backed up to <obs-studio>/basic/backup-<date>/ first.

    python obs-setup.py                      # 3 min buffer, detected screen size, best encoder found
    python obs-setup.py --buffer 300         # 5 min buffer (memory limit grows to match)
    python obs-setup.py --output "D:/Replays" --encoder nvenc-h264 --browser chrome
"""
import argparse
import ctypes
import glob
import json
import locale
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import uuid
from datetime import datetime

NAME = "snip-clip Replay"
LINUX = sys.platform.startswith("linux")
WAYLAND = LINUX and (os.environ.get("XDG_SESSION_TYPE") == "wayland" or "WAYLAND_DISPLAY" in os.environ)
FLATPAK_ID = "com.obsproject.Studio"
# Per-app audio on Linux: https://github.com/dimtpap/obs-pipewire-audio-capture
APP_AUDIO_PLUGIN = "linux-pipewire-audio.so"
APP_AUDIO_FLATPAK_ID = "com.obsproject.Studio.Plugin.PipeWireAudioCapture"

# OBS encoder id, 10-bit capable, peak bitrate (kbps) used to size the buffer's memory limit.
ENCODERS = {
    "nvenc-av1": ("obs_nvenc_av1_tex", True),    # NVIDIA RTX 40 and newer
    "nvenc-hevc": ("obs_nvenc_hevc_tex", True),
    "nvenc-h264": ("obs_nvenc_h264_tex", False),
    "vaapi-av1": ("av1_ffmpeg_vaapi_tex", False),  # Linux: AMD or Intel GPU
    "vaapi-hevc": ("hevc_ffmpeg_vaapi_tex", False),
    "vaapi-h264": ("ffmpeg_vaapi_tex", False),
    "x264": ("obs_x264", False),                 # CPU, any PC
}
MAX_KBPS = 80000

# Captured by executable (priority 2), so window titles do not matter.
APPS = {
    "discord": ("Discord", "Discord:Chrome_WidgetWin_1:Discord.exe"),
    "chrome": ("Chrome", "Google Chrome:Chrome_WidgetWin_1:chrome.exe"),
    "brave": ("Brave", "Brave:Chrome_WidgetWin_1:brave.exe"),
    "opera": ("Opera", "Opera:Chrome_WidgetWin_1:opera.exe"),
    "vivaldi": ("Vivaldi", "Vivaldi:Chrome_WidgetWin_1:vivaldi.exe"),
    "firefox": ("Firefox", "Mozilla Firefox:MozillaWindowClass:firefox.exe"),
    "zen": ("Zen", "Zen:MozillaWindowClass:zen.exe"),
}
# Linux: PipeWire process binaries or application names, matched without case.
LINUX_APPS = {
    "discord": ["Discord", "DiscordPTB", "DiscordCanary", "vesktop"],
    "chrome": ["chrome"],
    "brave": ["brave"],
    "opera": ["opera"],
    "vivaldi": ["vivaldi-bin"],
    "firefox": ["firefox", "firefox-bin", "Firefox"],
    "zen": ["zen", "zen-bin", "Zen"],
}

TRACK_NAMES = {
    "en": ["Mix", "Game", "Discord", "Browser", "Mic", "System (all)"],
    "pt": ["Mix", "Jogo", "Discord", "Navegador", "Microfone", "Sistema (tudo)"],
}
SOURCE_NAMES = {
    "en": {"screen": "Screen", "game": "Game", "browser": "Browser", "mic": "Mic"},
    "pt": {"screen": "Tela", "game": "Jogo", "browser": "Navegador", "mic": "Microfone"},
}


def screen_size():
    if LINUX:
        # Also works on Wayland through XWayland.
        r = run_quiet(["xrandr", "--current"])
        out = r.stdout if r and r.returncode == 0 else ""
        m = re.search(r" connected primary (\d+)x(\d+)", out) or re.search(r" connected (\d+)x(\d+)", out)
        return (int(m[1]), int(m[2])) if m else (1920, 1080)
    try:
        ctypes.windll.user32.SetProcessDPIAware()
        return ctypes.windll.user32.GetSystemMetrics(0), ctypes.windll.user32.GetSystemMetrics(1)
    except (AttributeError, OSError):
        return 1920, 1080


def system_lang():
    try:
        lang_id = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        return "pt" if (lang_id & 0x3FF) == 0x16 else "en"
    except (AttributeError, OSError):
        return "pt" if (locale.getlocale()[0] or "").lower().startswith("pt") else "en"


def videos_dir():
    home = os.path.expanduser("~")
    r = run_quiet(["xdg-user-dir", "VIDEOS"]) if LINUX else None
    found = r.stdout.strip() if r and r.returncode == 0 else ""
    return found if found and found != home else os.path.join(home, "Videos")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--buffer", type=int, default=180, help="replay length in seconds (default 180)")
    p.add_argument("--memory", type=int, help="replay buffer memory limit in MB (default: enough for --buffer at peak bitrate)")
    p.add_argument("--output", default=os.path.join(videos_dir(), "OBS Replays").replace("\\", "/"),
                   help="folder for saved replays (default ~/Videos/OBS Replays)")
    p.add_argument("--size", help="canvas and output size, e.g. 2560x1440 (default: main screen)")
    p.add_argument("--fps", type=int, default=60)
    p.add_argument("--encoder", choices=["auto", *(k for k in ENCODERS if LINUX or not k.startswith("vaapi"))],
                   default="auto",
                   help="auto (default) tests the GPU: NVENC AV1, then HEVC, then H.264, "
                        + ("then VAAPI AV1, HEVC, H.264, " if LINUX else "") + "else x264 on the CPU")
    p.add_argument("--quality", type=int, default=28, help="constant quality, lower = better (default 28)")
    p.add_argument("--browser", action="append", choices=[k for k in APPS if k != "discord"],
                   help="browser to capture on the Browser track; repeat for several (default: chrome, firefox)")
    p.add_argument("--lang", choices=TRACK_NAMES, default=system_lang(), help="language of track and source names")
    if LINUX:
        p.add_argument("--app-audio", choices=["auto", "on", "off"], default="auto",
                       help="Game, Discord and Browser tracks through the obs-pipewire-audio-capture plugin "
                            "(default: on when the plugin is installed)")
    return p.parse_args()


NVENC_ORDER = [("nvenc-av1", "av1_nvenc"), ("nvenc-hevc", "hevc_nvenc"), ("nvenc-h264", "h264_nvenc")]
VAAPI_ORDER = [("vaapi-av1", "av1_vaapi"), ("vaapi-hevc", "hevc_vaapi"), ("vaapi-h264", "h264_vaapi")]


def find_ffmpeg():
    found = shutil.which("ffmpeg")
    if found or LINUX:
        return found
    packages = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages")
    for root, _, files in os.walk(packages) if os.path.isdir(packages) else []:
        if "ffmpeg.exe" in files:
            return os.path.join(root, "ffmpeg.exe")
    return None


def run_quiet(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=20,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return None


def detect_encoder():
    """Picks the best encoder this PC can actually use. Returns (key, reason)."""
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        # A real 3-frame test encode: listing an encoder does not mean the GPU supports it.
        test = [ffmpeg, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x240:r=30:d=0.2", "-frames:v", "3"]
        for key, name in NVENC_ORDER:
            r = run_quiet(test + ["-pix_fmt", "yuv420p", "-c:v", name, "-f", "null", "-"])
            if r and r.returncode == 0:
                return key, f"tested with FFmpeg ({name})"
        render_nodes = sorted(glob.glob("/dev/dri/renderD*")) if LINUX else []
        for key, name in VAAPI_ORDER if render_nodes else []:
            r = run_quiet(test[:4] + ["-vaapi_device", render_nodes[0]] + test[4:]
                          + ["-vf", "format=nv12,hwupload", "-c:v", name, "-f", "null", "-"])
            if r and r.returncode == 0:
                return key, f"tested with FFmpeg ({name})"
        return "x264", "no GPU encoder passed a test encode"
    r = run_quiet(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
    gpu = r.stdout.strip().splitlines()[0] if r and r.returncode == 0 and r.stdout.strip() else ""
    if not gpu:
        return "x264", "no NVIDIA GPU found"
    if re.search(r"RTX\s*[45]0\d\d|RTX\s*PRO|RTX\s*\d+\s*Ada", gpu, re.I):
        return "nvenc-av1", gpu
    if re.search(r"RTX\s*[23]0\d\d|GTX\s*1[06]\d\d", gpu, re.I):
        return "nvenc-hevc", gpu
    return "nvenc-h264", gpu


def memory_mb(seconds):
    # Peak video bitrate plus 6 audio tracks, with 25% headroom.
    return math.ceil((MAX_KBPS + 6 * 192) * seconds / 8 / 1000 * 1.25)


def basic_ini(a, width, height, rec_tracks):
    encoder, ten_bit = ENCODERS[a.encoder]
    tracks = "\n".join(f"Track{i}Bitrate=192\nTrack{i}Name={n}" for i, n in enumerate(TRACK_NAMES[a.lang], 1))
    return f"""[General]
Name={NAME}

[Output]
Mode=Advanced
FilenameFormatting=%CCYY.%MM.%DD - %hh.%mm.%ss

[AdvOut]
RecType=Standard
RecFilePath={a.output}
RecFormat2=mkv
RecEncoder={encoder}
RecAudioEncoder=ffmpeg_aac
RecTracks={rec_tracks}
RecUseRescale=false
RecFileNameWithoutSpace=false
RecRB=true
RecRBTime={a.buffer}
RecRBSize={a.memory or memory_mb(a.buffer)}
RecRBPrefix=Replay
{tracks}
Encoder=obs_nvenc_h264_tex
TrackIndex=1

[Video]
BaseCX={width}
BaseCY={height}
OutputCX={width}
OutputCY={height}
FPSType=0
FPSCommon={a.fps}
ScaleType=bicubic
ColorFormat={"P010" if ten_bit else "NV12"}
ColorSpace=709
ColorRange=Partial

[Audio]
SampleRate=48000
ChannelSetup=Stereo

[Hotkeys]
ReplayBuffer={{"ReplayBuffer.Save":[{{"alt":true,"key":"OBS_KEY_F10"}}]}}
"""


def record_encoder(a):
    if a.encoder == "x264":
        return {"rate_control": "CRF", "crf": a.quality - 5, "preset": "veryfast", "keyint_sec": 2, "profile": "high"}
    if a.encoder.startswith("vaapi"):
        # Constant QP works on every VAAPI driver; the device is left to OBS's default.
        return {"rate_control": "CQP", "qp": a.quality - 5, "keyint_sec": 2, "bf": 0}
    return {
        "rate_control": "CQVBR", "target_quality": a.quality, "max_bitrate": MAX_KBPS, "bitrate": MAX_KBPS // 2,
        "preset": "p5", "tune": "hq", "multipass": "qres", "lookahead": True,
        "adaptive_quantization": True, "keyint_sec": 2, "profile": "main",
    }


def tracks(*numbers):
    """Audio tracks (1-6) -> OBS mixer bitmask."""
    return sum(1 << (n - 1) for n in numbers)


def source(name, source_id, settings, mixers):
    return {"name": name, "uuid": str(uuid.uuid4()), "id": source_id, "versioned_id": source_id,
            "settings": settings, "mixers": mixers, "volume": 1.0, "enabled": True, "muted": False}


def scene_item(src, item_id, size=None):
    item = {"name": src["name"], "source_uuid": src["uuid"], "visible": True, "locked": False,
            "id": item_id, "pos": {"x": 0.0, "y": 0.0}, "scale": {"x": 1.0, "y": 1.0}, "align": 5, "rot": 0.0}
    if size:
        item.update({"bounds_type": 2, "bounds_align": 0, "bounds": {"x": float(size[0]), "y": float(size[1])}})
    return item


def windows_sources(a, names):
    """Video sources (bottom to top) and per-app audio sources."""
    # Shown when the game is not fullscreen (windowed/borderless games, desktop).
    screen = source(names["screen"], "monitor_capture", {"method": 0, "capture_cursor": True}, 0)
    game = source(names["game"], "game_capture",
                  {"capture_mode": "any_fullscreen", "capture_audio": True, "capture_cursor": True,
                   "allow_transparency": False, "limit_framerate": False}, tracks(1, 2))
    apps = [source(APPS["discord"][0], "wasapi_process_output_capture", {"window": APPS["discord"][1], "priority": 2}, tracks(1, 3))]
    for b in a.browser or ["chrome", "firefox"]:
        label, window = APPS[b]
        apps.append(source(f"{names['browser']} - {label}", "wasapi_process_output_capture",
                           {"window": window, "priority": 2}, tracks(1, 4)))
    return [screen, game], apps


def linux_sources(a, names, app_audio):
    """Video sources (bottom to top) and per-app audio sources (none without the plugin)."""
    if WAYLAND:
        # OBS asks which screen to share on its first start and remembers the choice.
        screen = source(names["screen"], "pipewire-screen-capture-source", {"ShowCursor": True}, 0)
    else:
        screen = source(names["screen"], "xshm_input_v2", {"screen": 0, "show_cursor": True}, 0)
    if not app_audio:
        return [screen], []

    def app_capture(name, apps, mixers, except_apps=False):
        return source(name, "pipewire_audio_application_capture",
                      {"CaptureMode": 1, "ExceptApp": except_apps, "apps": [{"value": n} for n in apps]}, mixers)

    discord = LINUX_APPS["discord"]
    browsers = [n for b in a.browser or ["chrome", "firefox"] for n in LINUX_APPS[b]]
    # No game capture on Linux: the Game track gets every app except Discord, the browsers and OBS.
    return [screen], [app_capture(names["game"], discord + browsers + ["obs"], tracks(1, 2), except_apps=True),
                      app_capture("Discord", discord, tracks(1, 3)),
                      app_capture(names["browser"], browsers, tracks(1, 4))]


def build_collection(a, size, app_audio):
    names = SOURCE_NAMES[a.lang]
    track_names = TRACK_NAMES[a.lang]
    if LINUX:
        video, apps = linux_sources(a, names, app_audio)
        system_id, mic_id = "pulse_output_capture", "pulse_input_capture"
    else:
        video, apps = windows_sources(a, names)
        system_id, mic_id = "wasapi_output_capture", "wasapi_input_capture"
    # Listed bottom to top: the screen sits behind the game.
    items = [scene_item(s, i + 1, size) for i, s in enumerate(video)]
    items += [scene_item(s, i + len(items) + 1) for i, s in enumerate(apps)]
    scene = source("Replay", "scene", {"id_counter": len(items), "custom_size": False, "items": items}, 0)
    return {
        "name": NAME,
        "current_scene": "Replay", "current_program_scene": "Replay",
        "scene_order": [{"name": "Replay"}],
        "sources": [scene] + video + apps,
        # System audio only on track 6 (keeps the Mix free of duplicates), unless no per-app source feeds the Mix.
        # Mic on Mix + track 5.
        "DesktopAudioDevice1": source(track_names[5], system_id, {"device_id": "default"}, tracks(6) if apps else tracks(1, 6)),
        "AuxAudioDevice1": source(names["mic"], mic_id, {"device_id": "default"}, tracks(1, 5)),
        "groups": [], "transitions": [], "current_transition": "Fade", "transition_duration": 300,
        "quick_transitions": [], "saved_projectors": [], "modules": {}, "version": 2,
    }


def obs_config_dir():
    """OBS settings folder. On Linux, the native OBS wins over the Flatpak when both are installed."""
    if not LINUX:
        return os.path.join(os.environ.get("APPDATA", ""), "obs-studio"), False
    native = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "obs-studio")
    if shutil.which("obs"):
        return native, False
    r = run_quiet(["flatpak", "info", FLATPAK_ID])
    if r and r.returncode == 0:
        return os.path.expanduser(f"~/.var/app/{FLATPAK_ID}/config/obs-studio"), True
    return native, False


def has_app_audio_plugin(config_dir, flatpak):
    if flatpak:
        r = run_quiet(["flatpak", "info", APP_AUDIO_FLATPAK_ID])
        return bool(r and r.returncode == 0)
    patterns = [os.path.join(config_dir, "plugins", "*", "bin", "64bit"), "/usr/lib*/obs-plugins",
                "/usr/lib/*/obs-plugins", "/usr/local/lib*/obs-plugins", "/usr/local/lib/*/obs-plugins"]
    return any(glob.glob(os.path.join(p, APP_AUDIO_PLUGIN)) for p in patterns)


def enable_websocket(config_dir):
    """Turns on OBS's built-in WebSocket server for obs-save-replay.py, keeping the port and password if set."""
    path = os.path.join(config_dir, "plugin_config", "obs-websocket", "config.json")
    try:
        with open(path, encoding="utf-8") as f:
            conf = json.load(f)
    except (OSError, ValueError):
        conf = {}
    conf.update(first_load=False, server_enabled=True)
    conf.setdefault("server_port", 4455)
    conf.setdefault("alerts_enabled", False)
    conf.setdefault("auth_required", True)
    if not conf.get("server_password"):
        conf["server_password"] = secrets.token_urlsafe(18)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(conf, f, indent=4)


def backup(basic, profile_dir, collection):
    dest = os.path.join(basic, "backup-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    if not (os.path.isdir(profile_dir) or os.path.isfile(collection)):
        return None
    os.makedirs(dest)
    if os.path.isdir(profile_dir):
        shutil.copytree(profile_dir, os.path.join(dest, "profile-" + NAME))
    if os.path.isfile(collection):
        shutil.copy2(collection, dest)
    return dest


def main():
    if sys.platform != "win32" and not LINUX:
        sys.exit("This script configures OBS on Windows and Linux only.")
    a = parse_args()
    config_dir, flatpak = obs_config_dir()
    basic = os.path.join(config_dir, "basic")
    profile_dir = os.path.join(basic, "profiles", NAME)
    collection = os.path.join(basic, "scenes", NAME.replace(" ", "_") + ".json")
    if a.encoder == "auto":
        a.encoder, why = detect_encoder()
        print(f"Encoder: {a.encoder} ({why}). Override with --encoder.")
        if a.encoder == "x264" and LINUX:
            print("Tip: install FFmpeg and run again to test AMD and Intel GPUs (VAAPI).")
        elif a.encoder == "x264":
            print("Tip: on an AMD or Intel GPU, pick its hardware encoder in OBS under Settings -> Output -> Recording.")
    app_audio = LINUX and (a.app_audio == "on" or a.app_audio == "auto" and has_app_audio_plugin(config_dir, flatpak))
    if LINUX and not app_audio:
        print("Per-app audio is off: the Game, Discord and Browser tracks need the obs-pipewire-audio-capture plugin. "
              "Install it and run again (see README).")
    width, height = map(int, a.size.lower().split("x")) if a.size else screen_size()
    saved = backup(basic, profile_dir, collection)
    if saved:
        print("Backup:", saved)
    os.makedirs(profile_dir, exist_ok=True)
    os.makedirs(os.path.dirname(collection), exist_ok=True)
    os.makedirs(a.output, exist_ok=True)
    rec_tracks = tracks(1, 5, 6) if LINUX and not app_audio else tracks(1, 2, 3, 4, 5, 6)
    with open(os.path.join(profile_dir, "basic.ini"), "w", encoding="utf-8") as f:
        f.write(basic_ini(a, width, height, rec_tracks))
    with open(os.path.join(profile_dir, "recordEncoder.json"), "w", encoding="utf-8") as f:
        json.dump(record_encoder(a), f)
    with open(collection, "w", encoding="utf-8") as f:
        json.dump(build_collection(a, (width, height), app_audio), f, ensure_ascii=False, indent=2)
    print(f"Created OBS profile and scene collection '{NAME}'{' (Flatpak)' if flatpak else ''}: {width}x{height} @ {a.fps} fps, "
          f"{a.encoder}, {a.buffer} s buffer, replays in {a.output}.")
    if WAYLAND:
        enable_websocket(config_dir)
        save = os.path.join(os.path.dirname(os.path.abspath(__file__)), "obs-save-replay.py")
        print("Wayland: OBS only sees Alt+F10 while its window has focus. In your desktop's keyboard settings, "
              f"bind Alt+F10 to: python3 \"{save}\" (OBS's WebSocket server is now on for it).")
    else:
        print("Save a replay with Alt+F10.")


if __name__ == "__main__":
    main()
