// Background export queue (FR-18): jobs run one at a time while the user keeps editing.
import { appCacheDir, join } from "@tauri-apps/api/path";
import { create } from "zustand";
import {
  clipFileName, montageFileName, pickBackend, planOutput, PRESETS, runExport, totalDuration, uniqueNameAsync,
  type Cut, type ExportResult, type MediaInfo, type PresetId, type TrackMix,
} from "../core";
import i18n from "../i18n";
import { copyFiles, createRunner, ensureDir, pathExists, removeFile } from "../platform/tauri";
import { exportDir, notify, useApp } from "./app";
import { useEditor } from "./store";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ExportJob {
  id: string;
  /** Jobs queued by the same Export click; their files go to the clipboard together. */
  batch: string;
  /** File name once known; until then the cut label. */
  label: string;
  status: JobStatus;
  /** 0..1 within the current FFmpeg pass. */
  progress: number;
  pass: number;
  lowQuality: boolean;
  result?: ExportResult;
  error?: string;
  input: {
    media: MediaInfo;
    cuts: Cut[];
    mix: TrackMix[];
    presetId: PresetId;
    keepSeparateTracks: boolean;
    baseName: string;
  };
}

export const useExports = create<{ jobs: ExportJob[] }>(() => ({ jobs: [] }));

const cancels = new Map<string, () => Promise<boolean>>();
let working = false;

function patch(id: string, p: Partial<ExportJob>) {
  useExports.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
}

export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
}

/** Queues the current cuts with the current preset, mode and mix. Returns how many jobs were added. */
export function enqueueExport(): number {
  const s = useEditor.getState();
  if (!s.media || s.cuts.length === 0) return 0;
  const preset = PRESETS[s.presetId];
  const groups = s.mode === "montage" && preset.allowsMontage && s.cuts.length > 1 ? [s.cuts] : s.cuts.map((c) => [c]);
  const baseName = baseNameOf(s.media.path);
  const batch = crypto.randomUUID();
  const jobs: ExportJob[] = groups.map((cuts) => ({
    id: crypto.randomUUID(),
    batch,
    label: cuts.length > 1 ? montageFileName(baseName) : clipFileName(baseName, cuts[0]),
    status: "queued",
    progress: 0,
    pass: 0,
    lowQuality: planOutput(preset, s.media!, totalDuration(cuts)).lowQuality,
    input: { media: s.media!, cuts, mix: s.mix, presetId: s.presetId, keepSeparateTracks: s.keepSeparateTracks, baseName },
  }));
  useExports.setState((st) => ({ jobs: [...st.jobs, ...jobs] }));
  void work();
  return jobs.length;
}

export async function cancelJob(id: string) {
  const job = useExports.getState().jobs.find((j) => j.id === id);
  if (job?.status === "queued") patch(id, { status: "cancelled" });
  else if (job?.status === "running") await cancels.get(id)?.();
}

export function clearFinished() {
  useExports.setState((s) => ({ jobs: s.jobs.filter((j) => j.status === "queued" || j.status === "running") }));
}

async function work() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const job = useExports.getState().jobs.find((j) => j.status === "queued");
      if (!job) break;
      await runJob(job);
      await batchFinished(job.batch);
    }
  } finally {
    working = false;
  }
}

/** Once every job of a batch has ended, copies its exported files to the clipboard (FR-21). */
async function batchFinished(batch: string) {
  const jobs = useExports.getState().jobs.filter((j) => j.batch === batch);
  if (jobs.some((j) => j.status === "queued" || j.status === "running")) return;
  const paths = jobs.flatMap((j) => (j.status === "done" && j.result ? [j.result.outPath] : []));
  if (paths.length > 0 && useApp.getState().settings.copyAfterExport) await copyToClipboard(paths);
}

/** Copies exported files and says so; on failure points to "Show in folder". */
export async function copyToClipboard(paths: string[]) {
  try {
    await copyFiles(paths);
    const paste = navigator.platform.toLowerCase().includes("mac") ? "⌘V" : "Ctrl+V";
    notify(i18n.t("export.copied", { count: paths.length, paste }));
  } catch (e) {
    notify(`${i18n.t("export.copyFailed")} ${String(e)}`, true);
  }
}

async function runJob(job: ExportJob) {
  const { media, cuts, mix, presetId, keepSeparateTracks, baseName } = job.input;
  const preset = PRESETS[presetId];
  const duration = totalDuration(cuts);
  let outPath: string | null = null;
  patch(job.id, { status: "running" });
  try {
    const dir = await exportDir();
    await ensureDir(dir);
    const cacheDir = await appCacheDir();
    await ensureDir(cacheDir);
    const fileName = cuts.length > 1 ? montageFileName(baseName) : clipFileName(baseName, cuts[0]);
    const name = await uniqueNameAsync(fileName, async (n) => pathExists(await join(dir, n)));
    outPath = await join(dir, name);
    patch(job.id, { label: name });

    const { encoders, settings } = useApp.getState();
    const backend = preset.codec === "copy"
      ? "cpu"
      : pickBackend(preset.codec, encoders ?? new Set(), settings.encoder, preset.sizeLimitBytes !== null);
    const runner = createRunner(job.id, (sec) => patch(job.id, { progress: Math.min(1, sec / duration) }));
    cancels.set(job.id, runner.cancel);
    let pass = 0;
    const result = await runExport({
      media, cuts, mix, preset, keepSeparateTracks, backend,
      plan: planOutput(preset, media, duration),
      outPath,
      passLogPrefix: await join(cacheDir, "x264pass"),
    }, {
      run: (args) => {
        patch(job.id, { pass: ++pass, progress: 0 });
        return runner.run(args);
      },
      fileSize: runner.fileSize,
    });
    patch(job.id, { status: "done", progress: 1, result });
  } catch (e) {
    const cancelled = String(e).includes("cancelled");
    patch(job.id, { status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : String(e) });
    if (outPath) await removeFile(outPath).catch(() => {});
  } finally {
    cancels.delete(job.id);
  }
}
