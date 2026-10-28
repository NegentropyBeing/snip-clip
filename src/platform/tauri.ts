// Bridges the platform-independent core to the Rust backend (src-tauri/src).
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseProbe, PROBE_ARGS, type Exec, type ExecResult, type FfmpegRunner, type MediaInfo, type ReleaseInfo, type ReplayProfileFiles } from "../core";

export interface FfmpegInfo {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  source: "app" | "system";
}

interface ProgressEvent {
  jobId: string;
  outTimeSec: number;
  done: boolean;
}

export const locateFfmpeg = () => invoke<FfmpegInfo | null>("ffmpeg_locate");

/** The pinned FFmpeg build for this platform (FR-31); null when there is none. */
export interface FfmpegDownloadInfo {
  version: string;
  origin: string;
  bytes: number;
}

export interface DownloadProgress {
  stage: "download" | "extract";
  received: number;
  total: number;
}

export const ffmpegDownloadInfo = () => invoke<FfmpegDownloadInfo | null>("ffmpeg_download_info");
export const cancelFfmpegDownload = () => invoke<void>("ffmpeg_download_cancel");

/** Downloads, verifies and activates the pinned FFmpeg. Rejects with "cancelled" when cancelled. */
export async function downloadFfmpeg(onProgress: (p: DownloadProgress) => void): Promise<FfmpegInfo> {
  const unlisten = await listen<DownloadProgress>("ffmpeg-download", (e) => onProgress(e.payload));
  try {
    return await invoke<FfmpegInfo>("ffmpeg_download");
  } finally {
    unlisten();
  }
}

const execTool = (tool: "ffmpeg" | "ffprobe", args: string[]) => invoke<ExecResult>("exec_tool", { tool, args });

export const execFfmpeg: Exec = (args) => execTool("ffmpeg", args);

export async function probeMedia(path: string): Promise<MediaInfo> {
  const out = await execTool("ffprobe", [...PROBE_ARGS, path]);
  if (out.code !== 0) throw new Error(out.stderr.trim() || `ffprobe failed on ${path}`);
  return parseProbe(out.stdout, path);
}

/**
 * Runner for one export job. `onProgress` receives the output position in seconds;
 * every pass of a two-pass encode restarts from 0.
 */
export function createRunner(jobId: string, onProgress?: (outTimeSec: number) => void): FfmpegRunner & { cancel(): Promise<boolean> } {
  return {
    async run(args) {
      const unlisten = await listen<ProgressEvent>("ffmpeg-progress", (e) => {
        if (e.payload.jobId === jobId && !e.payload.done) onProgress?.(e.payload.outTimeSec);
      });
      try {
        await invoke("run_ffmpeg", { jobId, args });
      } finally {
        unlisten();
      }
    },
    fileSize: (path) => invoke<number>("file_size", { path }),
    cancel: () => invoke<boolean>("cancel_ffmpeg", { jobId }),
  };
}

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
export const ensureDir = (path: string) => invoke<void>("ensure_dir", { path });
export const fileStat = (path: string) => invoke<{ size: number; mtimeMs: number }>("file_stat", { path });
export const readText = (path: string) => invoke<string | null>("read_text", { path });
export const writeText = (path: string, contents: string) => invoke<void>("write_text", { path, contents });
export const removeFile = (path: string) => invoke<void>("remove_file", { path });
export const pruneDirs = (dir: string, keep: number, except?: string) => invoke<number>("prune_dirs", { dir, keep, except });

/** Puts the files themselves (not their paths) on the clipboard (FR-21). */
export const copyFiles = (paths: string[]) => invoke<void>("copy_files", { paths });

/** Published (non-draft) releases of the app on GitHub, newest first. */
export const listReleases = () => invoke<ReleaseInfo[]>("list_releases");

/** Where OBS is and what state the replay profile is in (spec §16). */
export interface ObsStatus {
  platform: "windows" | "linux" | "macos";
  install: { kind: "native" | "flatpak"; executable: string | null; configDir: string } | null;
  running: boolean;
  profileInstalled: boolean;
  autostart: boolean;
  wayland: boolean;
  appAudioPlugin: boolean;
  vaapiDevice: string | null;
}

export const obsStatus = () => invoke<ObsStatus>("obs_status");
/** The installed replay profile's files; null when it is not installed. */
export const obsReadProfile = () => invoke<ReplayProfileFiles | null>("obs_read_profile");
/** Backs up the current replay profile into `basic/backup-<stamp>` and writes `files`. Refused while OBS runs. */
export const obsInstallProfile = (files: ReplayProfileFiles, stamp: string) => invoke<string | null>("obs_install_profile", { files, stamp });
/** Deletes the replay profile; backups stay. Refused while OBS runs. */
export const obsRemoveProfile = () => invoke<void>("obs_remove_profile");
export const obsReadWebsocket = () => invoke<string | null>("obs_read_websocket");
/** Refused while OBS runs. */
export const obsWriteWebsocket = (contents: string) => invoke<void>("obs_write_websocket", { contents });
export const obsSetAutostart = (enabled: boolean) => invoke<void>("obs_set_autostart", { enabled });
/** Starts OBS in the replay profile with the replay buffer running; does nothing if OBS already runs. */
export const obsLaunch = () => invoke<void>("obs_launch");

/** URL the WebView can stream. Files outside the app cache must be allowed first (`allowAsset`). */
export const assetUrl = (path: string) => convertFileSrc(path);
export const allowAsset = (path: string) => invoke<void>("allow_asset", { path });

export async function readBytes(path: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
