// Temporary diagnostics screen: exercises the backend end to end until the editor UI lands.
import { appCacheDir, join, videoDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  clipFileName, detectEncoders, pickBackend, planOutput, PRESETS, runExport, uniqueNameAsync,
  type ExportResult, type MediaInfo,
} from "./core";
import { createRunner, ensureDir, execFfmpeg, locateFfmpeg, pathExists, probeMedia, type FfmpegInfo } from "./platform/tauri";

const TEST_CUT_SEC = 10;

export default function App() {
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null | undefined>(undefined);
  const [encoders, setEncoders] = useState<string[]>([]);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      const info = await locateFfmpeg();
      setFfmpeg(info);
      if (info) setEncoders([...(await detectEncoders(execFfmpeg))].sort());
    })().catch((e) => setError(String(e)));
  }, []);

  async function openVideo() {
    setError("");
    setResult(null);
    const path = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "webm"] }] });
    if (typeof path === "string") setMedia(await probeMedia(path).catch((e) => { setError(String(e)); return null; }));
  }

  async function testExport() {
    if (!media) return;
    setError("");
    setResult(null);
    try {
      const preset = PRESETS["discord-20"];
      const start = Math.max(0, media.durationSec / 2 - TEST_CUT_SEC / 2);
      const cut = { id: "test", name: "", startSec: start, endSec: Math.min(media.durationSec, start + TEST_CUT_SEC) };
      const outDir = await join(await videoDir(), "Clips");
      const cacheDir = await appCacheDir();
      await ensureDir(outDir);
      await ensureDir(cacheDir);
      const base = media.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      const name = await uniqueNameAsync(clipFileName(base, cut), async (n) => pathExists(await join(outDir, n)));
      const backend = pickBackend("h264", new Set(encoders), "auto", true);
      const runner = createRunner(crypto.randomUUID(), (sec) => setProgress(`${sec.toFixed(1)} s / ${TEST_CUT_SEC} s`));
      setProgress(`starting (${backend})…`);
      const r = await runExport({
        media, cuts: [cut], preset, backend,
        mix: media.audioTracks.map(() => ({ enabled: true, volume: 1 })),
        plan: planOutput(preset, media, cut.endSec - cut.startSec),
        outPath: await join(outDir, name),
        passLogPrefix: await join(cacheDir, "x264pass"),
      }, runner);
      setResult(r);
      setProgress("done");
    } catch (e) {
      setError(String(e));
      setProgress("");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 p-6 font-sans text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <h1 className="text-2xl font-semibold">clip-snip · diagnostics</h1>
      <p className="mb-6 text-sm text-neutral-500">Temporary screen to verify the backend. The editor comes next.</p>

      <section className="mb-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-medium">FFmpeg</h2>
        {ffmpeg === undefined && <p>Looking for FFmpeg…</p>}
        {ffmpeg === null && <p className="text-amber-600">FFmpeg not found. (Download flow not implemented yet.)</p>}
        {ffmpeg && (
          <ul className="text-sm">
            <li>Version: <code>{ffmpeg.version}</code> ({ffmpeg.source})</li>
            <li>Path: <code>{ffmpeg.ffmpeg}</code></li>
            <li>Usable encoders: {encoders.length ? encoders.map((e) => <code key={e} className="mr-2">{e}</code>) : "testing…"}</li>
          </ul>
        )}
      </section>

      <section className="mb-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <div className="mb-2 flex gap-2">
          <button className="rounded bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={!ffmpeg} onClick={openVideo}>Open video…</button>
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={!media || encoders.length === 0} onClick={testExport}>
            Export {TEST_CUT_SEC}s test clip (Discord 20 MB)
          </button>
        </div>
        {media && (
          <ul className="text-sm">
            <li><code>{media.path}</code></li>
            <li>{media.width}×{media.height} @ {media.fps} fps · {media.videoCodec}{media.hdr ? " · HDR" : ""} · {media.durationSec.toFixed(1)} s</li>
            <li>Audio: {media.audioTracks.map((t) => `${t.index + 1}: ${t.title ?? `Track ${t.index + 1}`}`).join(" · ") || "none"}</li>
          </ul>
        )}
        {progress && <p className="mt-2 text-sm">Progress: {progress}</p>}
        {result && (
          <p className="mt-2 text-sm text-emerald-600">
            Saved <code>{result.outPath}</code> — {(result.bytes / 1e6).toFixed(2)} MB in {result.attempts} attempt(s)
          </p>
        )}
        {error && <pre className="mt-2 whitespace-pre-wrap text-sm text-red-600">{error}</pre>}
      </section>
    </main>
  );
}
