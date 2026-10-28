// The replay profile (spec §16): the OBS profile and scene collection snip-clip installs,
// built here as file contents. Reading and writing them is the backend's job.

export const REPLAY_PROFILE_NAME = "snip-clip Replay";
/** Paths inside OBS's `basic` settings folder. */
export const REPLAY_PROFILE_FILES = {
  basicIni: `profiles/${REPLAY_PROFILE_NAME}/basic.ini`,
  recordEncoder: `profiles/${REPLAY_PROFILE_NAME}/recordEncoder.json`,
  collection: `scenes/${REPLAY_PROFILE_NAME.replace(/ /g, "_")}.json`,
} as const;

export type RecordingEncoder =
  | "nvenc-av1" | "nvenc-hevc" | "nvenc-h264"
  | "amf-av1" | "amf-hevc" | "amf-h264"
  | "qsv-av1" | "qsv-hevc" | "qsv-h264"
  | "vaapi-av1" | "vaapi-hevc" | "vaapi-h264"
  | "x264";

export type Browser = "chrome" | "brave" | "opera" | "vivaldi" | "firefox" | "zen";
export type TrackLang = "en" | "pt";
export type RecordingPlatform = "windows" | "linux";

/** OBS hotkey combination, e.g. Alt+F10 = { key: "OBS_KEY_F10", alt: true }. */
export interface ObsHotkey {
  key: string;
  shift?: boolean;
  control?: boolean;
  alt?: boolean;
  command?: boolean;
}

export interface ReplayProfileOptions {
  bufferSec: number;
  /** Replay buffer memory limit; null = enough for `bufferSec` at the peak bitrate. */
  memoryMb: number | null;
  replaysFolder: string;
  width: number;
  height: number;
  fps: number;
  encoder: RecordingEncoder;
  /** Constant quality, lower = better (NVENC CQ scale). */
  quality: number;
  browsers: Browser[];
  lang: TrackLang;
  saveHotkey: ObsHotkey;
}

export interface RecordingEnv {
  platform: RecordingPlatform;
  /** Linux only: PipeWire screen capture on Wayland, XSHM on X11. */
  wayland: boolean;
  /** Linux only: per-app tracks through the obs-pipewire-audio-capture plugin. */
  appAudio: boolean;
}

export interface ReplayProfileFiles {
  basicIni: string;
  recordEncoder: string;
  collection: string;
}

export const DEFAULT_SAVE_HOTKEY: ObsHotkey = { key: "OBS_KEY_F10", alt: true };

export function defaultReplayOptions(replaysFolder: string, width: number, height: number, lang: TrackLang): ReplayProfileOptions {
  return {
    bufferSec: 180, memoryMb: null, replaysFolder, width, height, fps: 60, encoder: "x264", quality: 28,
    browsers: ["chrome", "firefox"], lang, saveHotkey: DEFAULT_SAVE_HOTKEY,
  };
}

interface EncoderInfo {
  obsId: string;
  /** FFmpeg encoder that proves the hardware works; null for x264, which always does. */
  ffmpeg: string | null;
  platforms: RecordingPlatform[];
  tenBit: boolean;
}

/** In order of preference for the automatic choice (FR-41). */
export const RECORDING_ENCODERS: Record<RecordingEncoder, EncoderInfo> = {
  "nvenc-av1": { obsId: "obs_nvenc_av1_tex", ffmpeg: "av1_nvenc", platforms: ["windows", "linux"], tenBit: true },
  "nvenc-hevc": { obsId: "obs_nvenc_hevc_tex", ffmpeg: "hevc_nvenc", platforms: ["windows", "linux"], tenBit: true },
  "nvenc-h264": { obsId: "obs_nvenc_h264_tex", ffmpeg: "h264_nvenc", platforms: ["windows", "linux"], tenBit: false },
  "amf-av1": { obsId: "av1_texture_amf", ffmpeg: "av1_amf", platforms: ["windows"], tenBit: false },
  "amf-hevc": { obsId: "h265_texture_amf", ffmpeg: "hevc_amf", platforms: ["windows"], tenBit: false },
  "amf-h264": { obsId: "h264_texture_amf", ffmpeg: "h264_amf", platforms: ["windows"], tenBit: false },
  "qsv-av1": { obsId: "obs_qsv11_av1", ffmpeg: "av1_qsv", platforms: ["windows"], tenBit: false },
  "qsv-hevc": { obsId: "obs_qsv11_hevc", ffmpeg: "hevc_qsv", platforms: ["windows"], tenBit: false },
  "qsv-h264": { obsId: "obs_qsv11_v2", ffmpeg: "h264_qsv", platforms: ["windows"], tenBit: false },
  "vaapi-av1": { obsId: "av1_ffmpeg_vaapi_tex", ffmpeg: "av1_vaapi", platforms: ["linux"], tenBit: false },
  "vaapi-hevc": { obsId: "hevc_ffmpeg_vaapi_tex", ffmpeg: "hevc_vaapi", platforms: ["linux"], tenBit: false },
  "vaapi-h264": { obsId: "ffmpeg_vaapi_tex", ffmpeg: "h264_vaapi", platforms: ["linux"], tenBit: false },
  x264: { obsId: "obs_x264", ffmpeg: null, platforms: ["windows", "linux"], tenBit: false },
};

/** Encoders OBS offers on this platform, in order of preference. */
export function recordingEncoders(platform: RecordingPlatform): RecordingEncoder[] {
  return (Object.keys(RECORDING_ENCODERS) as RecordingEncoder[]).filter((e) => RECORDING_ENCODERS[e].platforms.includes(platform));
}

/** FFmpeg encoders to test-encode before picking a recording encoder. */
export function recordingEncoderCandidates(platform: RecordingPlatform): string[] {
  return recordingEncoders(platform).flatMap((e) => RECORDING_ENCODERS[e].ffmpeg ?? []);
}

/** The best recording encoder among those whose FFmpeg counterpart passed a test encode. */
export function pickRecordingEncoder(usable: ReadonlySet<string>, platform: RecordingPlatform): RecordingEncoder {
  return recordingEncoders(platform).find((e) => {
    const ffmpeg = RECORDING_ENCODERS[e].ffmpeg;
    return ffmpeg === null || usable.has(ffmpeg);
  }) ?? "x264";
}

/** Peak video bitrate (kbps) used to size the replay buffer's memory limit. */
const MAX_KBPS = 80000;
const AUDIO_KBPS = 192;

/** Peak video bitrate plus 6 audio tracks, with 25% headroom. */
export function defaultMemoryMb(bufferSec: number): number {
  return Math.ceil(((MAX_KBPS + 6 * AUDIO_KBPS) * bufferSec / 8 / 1000) * 1.25);
}

const TRACK_NAMES: Record<TrackLang, string[]> = {
  en: ["Mix", "Game", "Discord", "Browser", "Mic", "System (all)"],
  pt: ["Mix", "Jogo", "Discord", "Navegador", "Microfone", "Sistema (tudo)"],
};
const SOURCE_NAMES: Record<TrackLang, { screen: string; game: string; browser: string; mic: string }> = {
  en: { screen: "Screen", game: "Game", browser: "Browser", mic: "Mic" },
  pt: { screen: "Tela", game: "Jogo", browser: "Navegador", mic: "Microfone" },
};

/** Windows: captured by executable (priority 2), so window titles do not matter. */
const WINDOWS_APPS: Record<Browser | "discord", { label: string; window: string }> = {
  discord: { label: "Discord", window: "Discord:Chrome_WidgetWin_1:Discord.exe" },
  chrome: { label: "Chrome", window: "Google Chrome:Chrome_WidgetWin_1:chrome.exe" },
  brave: { label: "Brave", window: "Brave:Chrome_WidgetWin_1:brave.exe" },
  opera: { label: "Opera", window: "Opera:Chrome_WidgetWin_1:opera.exe" },
  vivaldi: { label: "Vivaldi", window: "Vivaldi:Chrome_WidgetWin_1:vivaldi.exe" },
  firefox: { label: "Firefox", window: "Mozilla Firefox:MozillaWindowClass:firefox.exe" },
  zen: { label: "Zen", window: "Zen:MozillaWindowClass:zen.exe" },
};
/** Linux: PipeWire process binaries or application names, matched without case. */
const LINUX_APPS: Record<Browser | "discord", string[]> = {
  discord: ["Discord", "DiscordPTB", "DiscordCanary", "vesktop"],
  chrome: ["chrome"],
  brave: ["brave"],
  opera: ["opera"],
  vivaldi: ["vivaldi-bin"],
  firefox: ["firefox", "firefox-bin", "Firefox"],
  zen: ["zen", "zen-bin", "Zen"],
};
const BROWSERS = Object.keys(LINUX_APPS).filter((k) => k !== "discord") as Browser[];

/** Audio tracks (1-6) -> OBS mixer bitmask. */
function tracks(...numbers: number[]): number {
  return numbers.reduce((mask, n) => mask | (1 << (n - 1)), 0);
}

const ALL_TRACKS = tracks(1, 2, 3, 4, 5, 6);

/** The tracks recorded: all six, or Mix, Mic and System when Linux has no per-app audio. */
export function recordedTracks(env: RecordingEnv): number {
  return env.platform === "linux" && !env.appAudio ? tracks(1, 5, 6) : ALL_TRACKS;
}

function basicIni(o: ReplayProfileOptions, env: RecordingEnv): string {
  const encoder = RECORDING_ENCODERS[o.encoder];
  const trackLines = TRACK_NAMES[o.lang].map((n, i) => `Track${i + 1}Bitrate=${AUDIO_KBPS}\nTrack${i + 1}Name=${n}`).join("\n");
  // Modifiers first, key last, as OBS writes them.
  const { key, ...modifiers } = o.saveHotkey;
  const hotkeys = JSON.stringify({ "ReplayBuffer.Save": [{ ...modifiers, key }] });
  return `[General]
Name=${REPLAY_PROFILE_NAME}

[Output]
Mode=Advanced
FilenameFormatting=%CCYY.%MM.%DD - %hh.%mm.%ss

[AdvOut]
RecType=Standard
RecFilePath=${o.replaysFolder.replace(/\\/g, "/")}
RecFormat2=mkv
RecEncoder=${encoder.obsId}
RecAudioEncoder=ffmpeg_aac
RecTracks=${recordedTracks(env)}
RecUseRescale=false
RecFileNameWithoutSpace=false
RecRB=true
RecRBTime=${o.bufferSec}
RecRBSize=${o.memoryMb ?? defaultMemoryMb(o.bufferSec)}
RecRBPrefix=Replay
${trackLines}
Encoder=obs_nvenc_h264_tex
TrackIndex=1

[Video]
BaseCX=${o.width}
BaseCY=${o.height}
OutputCX=${o.width}
OutputCY=${o.height}
FPSType=0
FPSCommon=${o.fps}
ScaleType=bicubic
ColorFormat=${encoder.tenBit ? "P010" : "NV12"}
ColorSpace=709
ColorRange=Partial

[Audio]
SampleRate=48000
ChannelSetup=Stereo

[Hotkeys]
ReplayBuffer=${hotkeys}
`;
}

/** AMF and QuickSync AV1 take QP on a 0-63 scale instead of 0-51. */
const AV1_QP_SCALE = 63 / 51;
/** CQP and CRF run 5 below the NVENC CQ value for similar quality. */
const QP_OFFSET = 5;

function recordEncoderSettings(o: ReplayProfileOptions): Record<string, unknown> {
  const qp = o.quality - QP_OFFSET;
  const [backend, codec] = o.encoder.split("-");
  switch (backend) {
    case "x264":
      return { rate_control: "CRF", crf: qp, preset: "veryfast", keyint_sec: 2, profile: "high" };
    case "vaapi":
      // OBS scales AV1 QP itself; the device is left to OBS's default.
      return { rate_control: "CQP", qp, keyint_sec: 2, bf: 0 };
    case "amf":
    case "qsv":
      return { rate_control: "CQP", cqp: codec === "av1" ? Math.round(qp * AV1_QP_SCALE) : qp, keyint_sec: 2 };
    default:
      return {
        rate_control: "CQVBR", target_quality: o.quality, max_bitrate: MAX_KBPS, bitrate: MAX_KBPS / 2,
        preset: "p5", tune: "hq", multipass: "qres", lookahead: true,
        adaptive_quantization: true, keyint_sec: 2, profile: "main",
      };
  }
}

type Json = Record<string, unknown>;

function source(uuid: () => string, name: string, id: string, settings: Json, mixers: number): Json {
  return { name, uuid: uuid(), id, versioned_id: id, settings, mixers, volume: 1.0, enabled: true, muted: false };
}

function sceneItem(src: Json, itemId: number, size?: [number, number]): Json {
  const item: Json = {
    name: src.name, source_uuid: src.uuid, visible: true, locked: false,
    id: itemId, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, align: 5, rot: 0,
  };
  if (size) Object.assign(item, { bounds_type: 2, bounds_align: 0, bounds: { x: size[0], y: size[1] } });
  return item;
}

/** Video sources (bottom to top) and per-app audio sources. */
function windowsSources(o: ReplayProfileOptions, uuid: () => string): [Json[], Json[]] {
  const names = SOURCE_NAMES[o.lang];
  // Shown when the game is not fullscreen (windowed/borderless games, desktop).
  const screen = source(uuid, names.screen, "monitor_capture", { method: 0, capture_cursor: true }, 0);
  const game = source(uuid, names.game, "game_capture", {
    capture_mode: "any_fullscreen", capture_audio: true, capture_cursor: true,
    allow_transparency: false, limit_framerate: false,
  }, tracks(1, 2));
  const app = (name: string, key: Browser | "discord", mixers: number) =>
    source(uuid, name, "wasapi_process_output_capture", { window: WINDOWS_APPS[key].window, priority: 2 }, mixers);
  const apps = [app(WINDOWS_APPS.discord.label, "discord", tracks(1, 3))];
  for (const b of o.browsers) apps.push(app(`${names.browser} - ${WINDOWS_APPS[b].label}`, b, tracks(1, 4)));
  return [[screen, game], apps];
}

/** Video sources and per-app audio sources (none without the plugin). */
function linuxSources(o: ReplayProfileOptions, env: RecordingEnv, uuid: () => string): [Json[], Json[]] {
  const names = SOURCE_NAMES[o.lang];
  const screen = env.wayland
    // OBS asks which screen to share on its first start and remembers the choice.
    ? source(uuid, names.screen, "pipewire-screen-capture-source", { ShowCursor: true }, 0)
    : source(uuid, names.screen, "xshm_input_v2", { screen: 0, show_cursor: true }, 0);
  if (!env.appAudio) return [[screen], []];
  const app = (name: string, apps: string[], mixers: number, exceptApps = false) =>
    source(uuid, name, "pipewire_audio_application_capture",
      { CaptureMode: 1, ExceptApp: exceptApps, apps: apps.map((value) => ({ value })) }, mixers);
  const discord = LINUX_APPS.discord;
  const browsers = o.browsers.flatMap((b) => LINUX_APPS[b]);
  // No game capture on Linux: the Game track gets every app except Discord, the browsers and OBS.
  return [[screen], [
    app(names.game, [...discord, ...browsers, "obs"], tracks(1, 2), true),
    app("Discord", discord, tracks(1, 3)),
    app(names.browser, browsers, tracks(1, 4)),
  ]];
}

function sceneCollection(o: ReplayProfileOptions, env: RecordingEnv, uuid: () => string): Json {
  const names = SOURCE_NAMES[o.lang];
  const linux = env.platform === "linux";
  const [video, apps] = linux ? linuxSources(o, env, uuid) : windowsSources(o, uuid);
  const size: [number, number] = [o.width, o.height];
  // Listed bottom to top: the screen sits behind the game.
  const items = [...video.map((s, i) => sceneItem(s, i + 1, size)), ...apps.map((s, i) => sceneItem(s, video.length + i + 1))];
  const scene = source(uuid, "Replay", "scene", { id_counter: items.length, custom_size: false, items }, 0);
  return {
    name: REPLAY_PROFILE_NAME,
    current_scene: "Replay", current_program_scene: "Replay",
    scene_order: [{ name: "Replay" }],
    sources: [scene, ...video, ...apps],
    // System audio only on track 6 (keeps the Mix free of duplicates), unless no per-app source feeds the Mix.
    // Mic on Mix + track 5.
    DesktopAudioDevice1: source(uuid, TRACK_NAMES[o.lang][5], linux ? "pulse_output_capture" : "wasapi_output_capture",
      { device_id: "default" }, apps.length ? tracks(6) : tracks(1, 6)),
    AuxAudioDevice1: source(uuid, names.mic, linux ? "pulse_input_capture" : "wasapi_input_capture",
      { device_id: "default" }, tracks(1, 5)),
    groups: [], transitions: [], current_transition: "Fade", transition_duration: 300,
    quick_transitions: [], saved_projectors: [], modules: {}, version: 2,
  };
}

/** The replay profile's files. `uuid` makes source ids; pass a fixed sequence in tests. */
export function buildReplayProfile(
  o: ReplayProfileOptions,
  env: RecordingEnv,
  uuid: () => string = () => crypto.randomUUID(),
): ReplayProfileFiles {
  return {
    basicIni: basicIni(o, env),
    recordEncoder: JSON.stringify(recordEncoderSettings(o)),
    collection: JSON.stringify(sceneCollection(o, env, uuid), null, 2),
  };
}

/** `[section] key=value` lines -> { section: { key: value } }. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = out[""] = {} as Record<string, string>;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) section = out[header[1]] ??= {};
    else if (line.includes("=") && !line.startsWith(";") && !line.startsWith("#")) {
      const at = line.indexOf("=");
      section[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return out;
}

function parseJson(text: string | null): Json | null {
  try {
    const value: unknown = text ? JSON.parse(text) : null;
    return value && typeof value === "object" ? (value as Json) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function readQuality(encoder: RecordingEncoder, settings: Json | null): number | undefined {
  if (!settings) return undefined;
  const [backend, codec] = encoder.split("-");
  switch (backend) {
    case "x264": {
      const crf = num(settings.crf);
      return crf === undefined ? undefined : crf + QP_OFFSET;
    }
    case "vaapi": {
      const qp = num(settings.qp);
      return qp === undefined ? undefined : qp + QP_OFFSET;
    }
    case "amf":
    case "qsv": {
      const cqp = num(settings.cqp);
      if (cqp === undefined) return undefined;
      return Math.round(codec === "av1" ? cqp / AV1_QP_SCALE : cqp) + QP_OFFSET;
    }
    default:
      return num(settings.target_quality);
  }
}

function readBrowsers(collection: Json | null, platform: RecordingPlatform): Browser[] | undefined {
  const sources = collection?.sources;
  if (!Array.isArray(sources)) return undefined;
  const found = new Set<Browser>();
  let appSources = false;
  for (const s of sources as Json[]) {
    const settings = (s.settings ?? {}) as Json;
    if (platform === "windows" && s.id === "wasapi_process_output_capture") {
      appSources = true;
      const b = BROWSERS.find((k) => WINDOWS_APPS[k].window === settings.window);
      if (b) found.add(b);
    } else if (platform === "linux" && s.id === "pipewire_audio_application_capture") {
      appSources = true;
      if (settings.ExceptApp || !Array.isArray(settings.apps)) continue;
      const values = new Set((settings.apps as Json[]).map((a) => String(a.value).toLowerCase()));
      for (const b of BROWSERS) if (LINUX_APPS[b].every((n) => values.has(n.toLowerCase()))) found.add(b);
    }
  }
  // Without per-app sources (Linux without the plugin) the profile says nothing about browsers.
  return appSources ? BROWSERS.filter((b) => found.has(b)) : undefined;
}

/**
 * Options of an installed replay profile, read from OBS's own files (FR-37), so changes made
 * in OBS show up. Fields that cannot be read are left out; fill them from the defaults.
 */
export function readReplayProfile(
  files: { basicIni: string; recordEncoder: string | null; collection: string | null },
  platform: RecordingPlatform,
): Partial<ReplayProfileOptions> {
  const ini = parseIni(files.basicIni);
  const out = ini.AdvOut ?? {};
  const video = ini.Video ?? {};
  const o: Partial<ReplayProfileOptions> = {};
  const bufferSec = num(out.RecRBTime);
  if (bufferSec !== undefined) o.bufferSec = bufferSec;
  const memoryMb = num(out.RecRBSize);
  // A limit that matches the buffer's own default keeps following the buffer.
  if (memoryMb !== undefined) o.memoryMb = bufferSec !== undefined && memoryMb === defaultMemoryMb(bufferSec) ? null : memoryMb;
  if (out.RecFilePath) o.replaysFolder = out.RecFilePath;
  const width = num(video.OutputCX);
  const height = num(video.OutputCY);
  if (width !== undefined && height !== undefined) Object.assign(o, { width, height });
  const fps = num(video.FPSCommon);
  if (fps !== undefined) o.fps = fps;
  const encoder = (Object.keys(RECORDING_ENCODERS) as RecordingEncoder[]).find((e) => RECORDING_ENCODERS[e].obsId === out.RecEncoder);
  if (encoder) {
    o.encoder = encoder;
    const quality = readQuality(encoder, parseJson(files.recordEncoder));
    if (quality !== undefined) o.quality = quality;
  }
  const browsers = readBrowsers(parseJson(files.collection), platform);
  if (browsers) o.browsers = browsers;
  const hotkeys = parseJson(ini.Hotkeys?.ReplayBuffer ?? null)?.["ReplayBuffer.Save"];
  if (Array.isArray(hotkeys) && hotkeys[0] && typeof (hotkeys[0] as Json).key === "string") o.saveHotkey = hotkeys[0] as ObsHotkey;
  return o;
}

/** OBS's WebSocket server settings (`plugin_config/obs-websocket/config.json`). */
export interface WebsocketConfig {
  first_load?: boolean;
  server_enabled?: boolean;
  server_port?: number;
  alerts_enabled?: boolean;
  auth_required?: boolean;
  server_password?: string;
  [key: string]: unknown;
}

/**
 * Turns the server on for `snip-clip --save-replay` (FR-45), keeping the port and password if
 * set. `turnedOn` says whether snip-clip changed it, so removing the profile only turns off
 * what snip-clip turned on (FR-39).
 */
export function enableWebsocket(current: WebsocketConfig | null, newPassword: string): { config: WebsocketConfig; turnedOn: boolean } {
  const config: WebsocketConfig = {
    server_port: 4455, alerts_enabled: false, auth_required: true, ...current, first_load: false, server_enabled: true,
  };
  if (!config.server_password) config.server_password = newPassword;
  return { config, turnedOn: !current?.server_enabled };
}

export function disableWebsocket(current: WebsocketConfig): WebsocketConfig {
  return { ...current, server_enabled: false };
}
