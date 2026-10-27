// Bridges the platform-independent core to the Rust backend (src-tauri/src).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseProbe, PROBE_ARGS, type Exec, type ExecResult, type FfmpegRunner, type MediaInfo } from "../core";

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
