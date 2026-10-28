// The Recording tab's work (spec §16): load the replay profile, install it, remove it.
import { join, videoDir } from "@tauri-apps/api/path";
import {
  buildReplayProfile, defaultReplayOptions, detectEncoders, disableWebsocket, enableWebsocket, gnomeAccelerator,
  readReplayProfile, recordingEncoderCandidates, type RecordingEnv, type RecordingPlatform, type ReplayProfileOptions,
  type TrackLang, type WebsocketConfig,
} from "../core";
import i18n from "../i18n";
import {
  ensureDir, execFfmpeg, obsInstallProfile, obsReadProfile, obsReadWebsocket, obsRegisterGnomeShortcut, obsRemoveProfile,
  obsSetAutostart, obsUnregisterGnomeShortcut, obsWriteWebsocket, pathExists, type ObsStatus,
} from "../platform/tauri";
import { updateSettings, useApp } from "./app";

export function recordingEnv(status: ObsStatus): RecordingEnv {
  return { platform: status.platform === "linux" ? "linux" : "windows", wayland: status.wayland, appAudio: status.appAudioPlugin };
}

/**
 * Who listens for the save-replay hotkey (FR-44): OBS itself on Windows and X11; on Wayland OBS
 * hears it only while focused, so a GNOME shortcut runs `snip-clip --save-replay`, and on other
 * desktops the user sets that shortcut up.
 */
export type HotkeyMode = "obs" | "gnome" | "manual";

export function hotkeyMode(status: ObsStatus): HotkeyMode {
  if (status.platform !== "linux" || !status.wayland) return "obs";
  return /gnome/i.test(status.desktop ?? "") ? "gnome" : "manual";
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

/** The installed replay profile's replays folder, when it exists on disk. */
async function installedReplaysFolder(): Promise<string | null> {
  try {
    const files = await obsReadProfile();
    // The folder is read the same on every platform; OBS writes it with forward slashes.
    let folder = files && readReplayProfile(files, "linux").replaysFolder;
    if (!folder) return null;
    if (navigator.userAgent.includes("Windows")) folder = folder.replace(/\//g, "\\");
    return (await pathExists(folder)) ? folder : null;
  } catch {
    return null;
  }
}

/** Where the Open video dialog starts when no Open folder is set (FR-46). */
export async function defaultOpenDir(): Promise<string> {
  return (await installedReplaysFolder()) ?? videoDir();
}

/** Where the Open video dialog starts: the Open folder setting, else the replays folder, else Videos. */
export async function openDir(): Promise<string> {
  return useApp.getState().settings.openDir ?? defaultOpenDir();
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
 * for `snip-clip --save-replay` (FR-45) and, on GNOME, registers the hotkey with GNOME (FR-44).
 * Returns the backup folder of the previous version and GNOME's shortcuts on the same keys.
 */
export async function installReplayProfile(
  options: ReplayProfileOptions, status: ObsStatus, autostart: boolean,
): Promise<{ backup: string | null; conflicts: string[] }> {
  const env = recordingEnv(status);
  // OBS does not create the folder: without it, the replay buffer stops with "Bad File Path".
  await ensureDir(options.replaysFolder);
  const backup = await obsInstallProfile(buildReplayProfile(options, env), stamp());
  if (env.wayland) {
    const { config, turnedOn } = enableWebsocket(await readWebsocket(), randomPassword());
    await obsWriteWebsocket(JSON.stringify(config, null, 4));
    if (turnedOn) await updateSettings({ obsWebsocketOwned: true });
  }
  let conflicts: string[] = [];
  const accel = gnomeAccelerator(options.saveHotkey);
  if (hotkeyMode(status) === "gnome" && accel) {
    conflicts = await obsRegisterGnomeShortcut(accel, i18n.t("recording.gnomeShortcutName"));
  }
  if (autostart !== status.autostart) await obsSetAutostart(autostart);
  return { backup, conflicts };
}

/** Removes the replay profile, its start-at-login entry, and the WebSocket server if snip-clip turned it on (FR-39). */
export async function removeReplayProfile(status: ObsStatus): Promise<void> {
  await obsRemoveProfile();
  await obsSetAutostart(false);
  if (status.platform === "linux") await obsUnregisterGnomeShortcut().catch(() => {});
  if (useApp.getState().settings.obsWebsocketOwned) {
    const current = await readWebsocket();
    if (current) await obsWriteWebsocket(JSON.stringify(disableWebsocket(current), null, 4));
    await updateSettings({ obsWebsocketOwned: false });
  }
}

export { obsLaunch, obsSetAutostart, obsStatus, type ObsStatus } from "../platform/tauri";
