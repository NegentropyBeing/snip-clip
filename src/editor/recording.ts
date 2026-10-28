// The Recording tab's work (spec §16): load the replay profile, install it, remove it.
import { join, videoDir } from "@tauri-apps/api/path";
import {
  buildReplayProfile, defaultReplayOptions, detectEncoders, disableWebsocket, enableWebsocket, readReplayProfile,
  recordingEncoderCandidates, type RecordingEnv, type RecordingPlatform, type ReplayProfileOptions, type TrackLang,
  type WebsocketConfig,
} from "../core";
import i18n from "../i18n";
import {
  execFfmpeg, obsInstallProfile, obsReadProfile, obsReadWebsocket, obsRemoveProfile, obsSetAutostart,
  obsWriteWebsocket, type ObsStatus,
} from "../platform/tauri";
import { updateSettings, useApp } from "./app";

export function recordingEnv(status: ObsStatus): RecordingEnv {
  return { platform: status.platform === "linux" ? "linux" : "windows", wayland: status.wayland, appAudio: status.appAudioPlugin };
}

/** Track and source names follow the app's language. */
export const trackLang = (): TrackLang => (i18n.language.startsWith("pt") ? "pt" : "en");

/** The main screen in physical pixels, rounded to even numbers as encoders want. */
function screenSize(): [number, number] {
  const even = (n: number) => Math.round((n * window.devicePixelRatio) / 2) * 2;
  return [even(window.screen.width), even(window.screen.height)];
}

/** Options to show: the installed profile's (FR-37), filled in from the defaults. */
export async function loadReplayOptions(status: ObsStatus): Promise<{ options: ReplayProfileOptions; installed: boolean }> {
  const [width, height] = screenSize();
  const defaults = defaultReplayOptions(await join(await videoDir(), "OBS Replays"), width, height, trackLang());
  const files = status.install ? await obsReadProfile() : null;
  if (!files) return { options: defaults, installed: false };
  return { options: { ...defaults, ...readReplayProfile(files, recordingEnv(status).platform), lang: trackLang() }, installed: true };
}

let probed: Promise<Set<string>> | null = null;

/**
 * FFmpeg encoders behind OBS's recording encoders that work here (FR-41). Tested once per run,
 * when the tab first needs them; null without FFmpeg.
 */
export function recordingEncodersUsable(platform: RecordingPlatform, vaapiDevice: string | null): Promise<Set<string>> | null {
  if (!useApp.getState().ffmpeg) return null;
  probed ??= detectEncoders(execFfmpeg, recordingEncoderCandidates(platform), vaapiDevice ?? undefined);
  return probed;
}

/** "20261028-153000", local time: the backup folder's name. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
}

async function readWebsocket(): Promise<WebsocketConfig | null> {
  try {
    const text = await obsReadWebsocket();
    return text ? (JSON.parse(text) as WebsocketConfig) : null;
  } catch {
    return null;
  }
}

/**
 * Installs or reconfigures the replay profile. On Wayland also turns on OBS's WebSocket server
 * for `snip-clip --save-replay` (FR-45). Returns the backup folder of the previous version.
 */
export async function installReplayProfile(options: ReplayProfileOptions, status: ObsStatus, autostart: boolean): Promise<string | null> {
  const env = recordingEnv(status);
  const backup = await obsInstallProfile(buildReplayProfile(options, env), stamp());
  if (env.wayland) {
    const { config, turnedOn } = enableWebsocket(await readWebsocket(), randomPassword());
    await obsWriteWebsocket(JSON.stringify(config, null, 4));
    if (turnedOn) await updateSettings({ obsWebsocketOwned: true });
  }
  if (autostart !== status.autostart) await obsSetAutostart(autostart);
  return backup;
}

/** Removes the replay profile, its start-at-login entry, and the WebSocket server if snip-clip turned it on (FR-39). */
export async function removeReplayProfile(): Promise<void> {
  await obsRemoveProfile();
  await obsSetAutostart(false);
  if (useApp.getState().settings.obsWebsocketOwned) {
    const current = await readWebsocket();
    if (current) await obsWriteWebsocket(JSON.stringify(disableWebsocket(current), null, 4));
    await updateSettings({ obsWebsocketOwned: false });
  }
}

export { obsLaunch, obsSetAutostart, obsStatus, type ObsStatus } from "../platform/tauri";
