"""Creates an OBS Studio profile and scene collection, "snip-clip Replay", tuned for snip-clip (Windows).

Replay buffer always on, one audio track per source (game, Discord, browser, mic, system),
saved with a hotkey. Close OBS before running. The current profile and collection with the
same name, if any, are backed up to <obs-studio>/basic/backup-<date>/ first.

    python obs-setup.py                      # 3 min buffer, detected screen size, best encoder found
    python obs-setup.py --buffer 300         # 5 min buffer (memory limit grows to match)
    python obs-setup.py --output "D:/Replays" --encoder nvenc-h264 --browser chrome
"""
import argparse
import ctypes
import json
import locale
import math
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime

NAME = "snip-clip Replay"
BASIC = os.path.join(os.environ.get("APPDATA", ""), "obs-studio", "basic")
PROFILE_DIR = os.path.join(BASIC, "profiles", NAME)
COLLECTION = os.path.join(BASIC, "scenes", NAME.replace(" ", "_") + ".json")

# OBS encoder id, 10-bit capable, peak bitrate (kbps) used to size the buffer's memory limit.
ENCODERS = {
    "nvenc-av1": ("obs_nvenc_av1_tex", True),    # NVIDIA RTX 40 and newer
    "nvenc-hevc": ("obs_nvenc_hevc_tex", True),
    "nvenc-h264": ("obs_nvenc_h264_tex", False),
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

TRACK_NAMES = {
    "en": ["Mix", "Game", "Discord", "Browser", "Mic", "System (all)"],
    "pt": ["Mix", "Jogo", "Discord", "Navegador", "Microfone", "Sistema (tudo)"],
}
SOURCE_NAMES = {
    "en": {"screen": "Screen", "game": "Game", "browser": "Browser", "mic": "Mic"},
    "pt": {"screen": "Tela", "game": "Jogo", "browser": "Navegador", "mic": "Microfone"},
}


def screen_size():
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


def parse_args():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--buffer", type=int, default=180, help="replay length in seconds (default 180)")
    p.add_argument("--memory", type=int, help="replay buffer memory limit in MB (default: enough for --buffer at peak bitrate)")
    p.add_argument("--output", default=os.path.join(os.path.expanduser("~"), "Videos", "OBS Replays").replace("\\", "/"),
                   help="folder for saved replays (default ~/Videos/OBS Replays)")
    p.add_argument("--size", help="canvas and output size, e.g. 2560x1440 (default: main screen)")
    p.add_argument("--fps", type=int, default=60)
    p.add_argument("--encoder", choices=["auto", *ENCODERS], default="auto",
                   help="auto (default) tests the GPU: NVENC AV1, then HEVC, then H.264, else x264 on the CPU")
    p.add_argument("--quality", type=int, default=28, help="constant quality, lower = better (default 28)")
    p.add_argument("--browser", action="append", choices=[k for k in APPS if k != "discord"],
                   help="browser to capture on the Browser track; repeat for several (default: chrome, firefox)")
    p.add_argument("--lang", choices=TRACK_NAMES, default=system_lang(), help="language of track and source names")
    return p.parse_args()


NVENC_ORDER = [("nvenc-av1", "av1_nvenc"), ("nvenc-hevc", "hevc_nvenc"), ("nvenc-h264", "h264_nvenc")]


def find_ffmpeg():
    found = shutil.which("ffmpeg")
    if found:
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
        for key, name in NVENC_ORDER:
            r = run_quiet([ffmpeg, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x240:r=30:d=0.2",
                           "-frames:v", "3", "-pix_fmt", "yuv420p", "-c:v", name, "-f", "null", "-"])
            if r and r.returncode == 0:
                return key, f"tested with FFmpeg ({name})"
        return "x264", "no NVIDIA encoder passed a test encode"
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


def basic_ini(a, width, height):
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
RecFormat2=mp4
RecEncoder={encoder}
RecAudioEncoder=ffmpeg_aac
RecTracks=63
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


def build_collection(a, size):
    names = SOURCE_NAMES[a.lang]
    track_names = TRACK_NAMES[a.lang]
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
    # Listed bottom to top: the screen sits behind the game.
    items = [scene_item(screen, 1, size), scene_item(game, 2, size)]
    items += [scene_item(s, i + 3) for i, s in enumerate(apps)]
    scene = source("Replay", "scene", {"id_counter": len(items), "custom_size": False, "items": items}, 0)
    return {
        "name": NAME,
        "current_scene": "Replay", "current_program_scene": "Replay",
        "scene_order": [{"name": "Replay"}],
        "sources": [scene, screen, game] + apps,
        # System audio only on track 6 (keeps the Mix free of duplicates); mic on Mix + track 5.
        "DesktopAudioDevice1": source(track_names[5], "wasapi_output_capture", {"device_id": "default"}, tracks(6)),
        "AuxAudioDevice1": source(names["mic"], "wasapi_input_capture", {"device_id": "default"}, tracks(1, 5)),
        "groups": [], "transitions": [], "current_transition": "Fade", "transition_duration": 300,
        "quick_transitions": [], "saved_projectors": [], "modules": {}, "version": 2,
    }


def backup():
    dest = os.path.join(BASIC, "backup-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    if not (os.path.isdir(PROFILE_DIR) or os.path.isfile(COLLECTION)):
        return None
    os.makedirs(dest)
    if os.path.isdir(PROFILE_DIR):
        shutil.copytree(PROFILE_DIR, os.path.join(dest, "profile-" + NAME))
    if os.path.isfile(COLLECTION):
        shutil.copy2(COLLECTION, dest)
    return dest


def main():
    if sys.platform != "win32":
        sys.exit("This script configures OBS on Windows only.")
    a = parse_args()
    if a.encoder == "auto":
        a.encoder, why = detect_encoder()
        print(f"Encoder: {a.encoder} ({why}). Override with --encoder.")
        if a.encoder == "x264":
            print("Tip: on an AMD or Intel GPU, pick its hardware encoder in OBS under Settings -> Output -> Recording.")
    width, height = map(int, a.size.lower().split("x")) if a.size else screen_size()
    saved = backup()
    if saved:
        print("Backup:", saved)
    os.makedirs(PROFILE_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(COLLECTION), exist_ok=True)
    os.makedirs(a.output, exist_ok=True)
    with open(os.path.join(PROFILE_DIR, "basic.ini"), "w", encoding="utf-8") as f:
        f.write(basic_ini(a, width, height))
    with open(os.path.join(PROFILE_DIR, "recordEncoder.json"), "w", encoding="utf-8") as f:
        json.dump(record_encoder(a), f)
    with open(COLLECTION, "w", encoding="utf-8") as f:
        json.dump(build_collection(a, (width, height)), f, ensure_ascii=False, indent=2)
    print(f"Created OBS profile and scene collection '{NAME}': {width}x{height} @ {a.fps} fps, {a.encoder}, "
          f"{a.buffer} s buffer, replays in {a.output}. Save a replay with Alt+F10.")


if __name__ == "__main__":
    main()
