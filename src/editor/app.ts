// App-wide state: FFmpeg availability, usable encoders, user settings, update notice.
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir, join, videoDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { detectEncoders, DEFAULT_PRESET, newerRelease, PRESETS, type EncoderPreference, type PresetId } from "../core";
import i18n, { systemLanguage } from "../i18n";
import { execFfmpeg, listReleases, locateFfmpeg, readText, writeText, type FfmpegInfo } from "../platform/tauri";

export type Language = "system" | "en" | "pt-BR";
export type Theme = "system" | "light" | "dark";

export interface Settings {
  /** null = <system videos>/Clips (FR-19). */
  exportDir: string | null;
  encoder: EncoderPreference;
  /** Preset for videos opened for the first time. */
  defaultPreset: PresetId;
  /** Put finished exports on the clipboard (FR-21). */
  copyAfterExport: boolean;
  language: Language;
  theme: Theme;
  checkUpdates: boolean;
  /** Timeline waveform: the current mix, or one lane per audio track. */
  waveform: "mix" | "tracks";
}

export const DEFAULT_SETTINGS: Settings = {
  exportDir: null,
  encoder: "auto",
  defaultPreset: DEFAULT_PRESET,
  copyAfterExport: true,
  language: "system",
  theme: "system",
  checkUpdates: true,
  waveform: "mix",
};

export interface UpdateNotice {
  version: string;
  url: string;
}

interface AppState {
  /** undefined while looking; null when not found. */
  ffmpeg: FfmpegInfo | null | undefined;
  encoders: Set<string> | null;
  settings: Settings;
  version: string;
  update: UpdateNotice | null;
  settingsOpen: boolean;
  /** Short-lived message at the bottom of the window. */
  notice: { text: string; error: boolean } | null;
  error: string | null;
}

export const useApp = create<AppState>(() => ({
  ffmpeg: undefined,
  encoders: null,
  settings: DEFAULT_SETTINGS,
  version: "",
  update: null,
  settingsOpen: false,
  notice: null,
  error: null,
}));

const settingsPath = async () => join(await appDataDir(), "settings.json");

/** Keeps known fields with valid values; everything else falls back to the defaults. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const d = DEFAULT_SETTINGS;
  return {
    exportDir: typeof r.exportDir === "string" && r.exportDir ? r.exportDir : d.exportDir,
    encoder: pick(r.encoder, ["auto", "gpu", "cpu"] as const, d.encoder),
    defaultPreset: pick(r.defaultPreset, Object.keys(PRESETS) as PresetId[], d.defaultPreset),
    copyAfterExport: typeof r.copyAfterExport === "boolean" ? r.copyAfterExport : d.copyAfterExport,
    language: pick(r.language, ["system", "en", "pt-BR"] as const, d.language),
    theme: pick(r.theme, ["system", "light", "dark"] as const, d.theme),
    checkUpdates: typeof r.checkUpdates === "boolean" ? r.checkUpdates : d.checkUpdates,
    waveform: pick(r.waveform, ["mix", "tracks"] as const, d.waveform),
  };
}

let started = false;

/** Loads settings, finds FFmpeg and its encoders; on the first call also checks for updates. */
export async function initApp() {
  if (!started) {
    started = true;
    try {
      useApp.setState({ settings: parseSettings(JSON.parse((await readText(await settingsPath())) ?? "{}")) });
    } catch {
      // Defaults.
    }
    applySettings(useApp.getState().settings);
    void getVersion().then((version) => {
      useApp.setState({ version });
      if (useApp.getState().settings.checkUpdates) void checkForUpdate().catch(() => {});
    });
  }
  try {
    const ffmpeg = await locateFfmpeg();
    useApp.setState({ ffmpeg });
    if (ffmpeg) await ffmpegReady(ffmpeg);
  } catch (e) {
    useApp.setState({ ffmpeg: null, error: String(e) });
  }
}

/** Probes the encoders of a newly found or downloaded FFmpeg. */
export async function ffmpegReady(ffmpeg: FfmpegInfo) {
  useApp.setState({ ffmpeg, encoders: await detectEncoders(execFfmpeg) });
}

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...useApp.getState().settings, ...patch };
  useApp.setState({ settings });
  applySettings(settings);
  await writeText(await settingsPath(), JSON.stringify(settings, null, 2));
}

export async function exportDir(): Promise<string> {
  return useApp.getState().settings.exportDir ?? defaultExportDir();
}

export async function defaultExportDir(): Promise<string> {
  return join(await videoDir(), "Clips");
}

export const openSettings = (open = true) => useApp.setState({ settingsOpen: open });

let noticeTimer = 0;
export function notify(text: string, error = false) {
  clearTimeout(noticeTimer);
  useApp.setState({ notice: { text, error } });
  noticeTimer = window.setTimeout(() => useApp.setState({ notice: null }), error ? 8000 : 4000);
}

/** Asks GitHub for a newer release. Returns whether one was found; throws when offline. */
export async function checkForUpdate(): Promise<boolean> {
  const current = useApp.getState().version || (await getVersion());
  const found = newerRelease(current, await listReleases());
  useApp.setState({ update: found && { version: found.version, url: found.htmlUrl } });
  return found !== null;
}

// The `dark` class on <html> drives Tailwind's dark variant, so the theme setting can override the system.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => applySettings(useApp.getState().settings));
document.documentElement.classList.toggle("dark", darkQuery.matches);

function applySettings(s: Settings) {
  const dark = s.theme === "dark" || (s.theme === "system" && darkQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
  void getCurrentWindow().setTheme(s.theme === "system" ? null : s.theme).catch(() => {});
  const lng = s.language === "system" ? systemLanguage() : s.language;
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
}
