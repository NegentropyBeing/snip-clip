// App-wide state: FFmpeg availability, usable encoders and user settings.
import { appDataDir, join, videoDir } from "@tauri-apps/api/path";
import { create } from "zustand";
import { detectEncoders, type EncoderPreference } from "../core";
import { execFfmpeg, locateFfmpeg, readText, writeText, type FfmpegInfo } from "../platform/tauri";

export interface Settings {
  /** null = <system videos>/Clips (FR-19). */
  exportDir: string | null;
  encoder: EncoderPreference;
}

interface AppState {
  /** undefined while looking; null when not found. */
  ffmpeg: FfmpegInfo | null | undefined;
  encoders: Set<string> | null;
  settings: Settings;
  error: string | null;
}

export const useApp = create<AppState>(() => ({
  ffmpeg: undefined,
  encoders: null,
  settings: { exportDir: null, encoder: "auto" },
  error: null,
}));

const settingsPath = async () => join(await appDataDir(), "settings.json");

export async function initApp() {
  try {
    const raw = JSON.parse((await readText(await settingsPath())) ?? "{}");
    useApp.setState((s) => ({
      settings: {
        exportDir: typeof raw.exportDir === "string" ? raw.exportDir : s.settings.exportDir,
        encoder: ["auto", "gpu", "cpu"].includes(raw.encoder) ? raw.encoder : s.settings.encoder,
      },
    }));
  } catch {
    // Defaults.
  }
  try {
    const ffmpeg = await locateFfmpeg();
    useApp.setState({ ffmpeg });
    if (ffmpeg) useApp.setState({ encoders: await detectEncoders(execFfmpeg) });
  } catch (e) {
    useApp.setState({ ffmpeg: null, error: String(e) });
  }
}

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...useApp.getState().settings, ...patch };
  useApp.setState({ settings });
  await writeText(await settingsPath(), JSON.stringify(settings, null, 2));
}

export async function exportDir(): Promise<string> {
  return useApp.getState().settings.exportDir ?? join(await videoDir(), "Clips");
}
