import { retryKbps } from "./bitrate";
import { buildJob, type ExportRequest } from "./ffmpeg";

/** Platform side of an export: the Tauri backend in the app, Node in tests. */
export interface FfmpegRunner {
  run(args: string[]): Promise<void>;
  fileSize(path: string): Promise<number>;
}

export interface ExportResult {
  outPath: string;
  bytes: number;
  attempts: number;
  /** Video bitrate of the accepted attempt; null for unlimited/copy presets. */
  videoKbps: number | null;
}

export const MAX_ATTEMPTS = 4;

/**
 * Runs an export and re-encodes with a lower bitrate while the file is over the preset limit,
 * so the user never gets a file the destination would reject (spec 6.1).
 */
export async function runExport(req: ExportRequest, runner: FfmpegRunner): Promise<ExportResult> {
  const limit = req.preset.sizeLimitBytes;
  let current = req;
  for (let attempt = 1; ; attempt++) {
    for (const args of buildJob(current).passes) await runner.run(args);
    const bytes = await runner.fileSize(current.outPath);
    const kbps = current.plan.videoKbps;
    if (limit === null || kbps === null || bytes <= limit) {
      return { outPath: current.outPath, bytes, attempts: attempt, videoKbps: kbps };
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`output is ${bytes} bytes after ${attempt} attempts; limit is ${limit}`);
    }
    current = { ...current, plan: { ...current.plan, videoKbps: retryKbps(kbps, bytes, limit) } };
  }
}
