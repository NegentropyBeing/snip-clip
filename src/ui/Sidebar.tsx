import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { planOutput, PRESETS, totalDuration, type PresetId } from "../core";
import { cancelJob, clearFinished, enqueueExport, useExports, type ExportJob } from "../editor/exportQueue";
import { playback } from "../editor/playback";
import { editor, useEditor } from "../editor/store";
import { Button, formatDuration, IconButton, Kbd, ProgressBar, TimeInput } from "./common";

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
      <div className="mb-1.5 flex items-center">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

export function TrackMixer() {
  const { t } = useTranslation();
  const tracks = useEditor((s) => s.media?.audioTracks ?? []);
  const mix = useEditor((s) => s.mix);
  return (
    <Section title={t("editor.tracks")}>
      {tracks.length === 0 && <p className="text-sm text-neutral-500">{t("editor.noTracks")}</p>}
      <ul className="space-y-1">
        {tracks.map((tr) => {
          const m = mix[tr.index] ?? { enabled: true, volume: 1 };
          return (
            <li key={tr.index} className={`flex items-center gap-2 ${m.enabled ? "" : "opacity-50"}`}>
              <input
                type="checkbox"
                checked={m.enabled}
                title={t("editor.trackToggle")}
                onChange={(e) => editor.setTrack(tr.index, { enabled: e.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              <span className="w-24 truncate text-sm" title={tr.title ?? undefined}>
                {tr.title ?? t("editor.track", { n: tr.index + 1 })}
              </span>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(m.volume * 100)}
                disabled={!m.enabled}
                title={t("editor.volumeReset")}
                onChange={(e) => editor.setTrack(tr.index, { volume: Number(e.target.value) / 100 })}
                onDoubleClick={() => editor.setTrack(tr.index, { volume: 1 })}
                className="min-w-0 flex-1"
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-neutral-500">{Math.round(m.volume * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CutList() {
  const { t } = useTranslation();
  const cuts = useEditor((s) => s.cuts);
  const selectedId = useEditor((s) => s.selectedId);
  const duration = useEditor((s) => s.media?.durationSec ?? 0);

  const addAtPlayhead = () => {
    const now = useEditor.getState().time;
    editor.addCut(now, Math.min(duration, now + 10));
  };

  return (
    <Section title={`${t("editor.cuts")}${cuts.length ? ` · ${cuts.length}` : ""}`} action={<Button variant="ghost" className="!py-0.5 text-xs" onClick={addAtPlayhead}>+ {t("editor.addCut")}</Button>}>
      {cuts.length === 0 && <p className="text-sm text-neutral-500">{t("editor.noCuts")}</p>}
      <ol className="space-y-1">
        {cuts.map((c, i) => (
          <li
            key={c.id}
            onClick={() => {
              editor.select(c.id);
              playback.seek(c.startSec);
            }}
            className={`rounded-md border px-2 py-1.5 ${
              c.id === selectedId ? "border-amber-400 bg-amber-50 dark:bg-amber-400/10" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center gap-1">
              <span className="w-5 text-xs font-semibold text-neutral-500">{i + 1}</span>
              <input
                value={c.name}
                placeholder={t("editor.cutName")}
                onChange={(e) => editor.updateCut(c.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-neutral-300 focus:border-indigo-500 focus:outline-none dark:hover:border-neutral-600"
              />
              <IconButton label={t("editor.moveUp")} disabled={i === 0} onClick={(e) => { e.stopPropagation(); editor.moveCut(c.id, -1); }}>↑</IconButton>
              <IconButton label={t("editor.moveDown")} disabled={i === cuts.length - 1} onClick={(e) => { e.stopPropagation(); editor.moveCut(c.id, 1); }}>↓</IconButton>
              <IconButton label={`${t("editor.remove")} (Delete)`} onClick={(e) => { e.stopPropagation(); editor.removeCut(c.id); }}>✕</IconButton>
            </div>
            <div className="mt-0.5 flex items-center gap-0.5 pl-5 text-xs text-neutral-500" onClick={(e) => e.stopPropagation()}>
              <IconButton label={t("editor.setStartHere")} className="!h-5 !w-5 text-xs" onClick={() => editor.setCutEdge(c.id, "start", useEditor.getState().time)}>⇤</IconButton>
              <TimeInput label={t("editor.start")} value={c.startSec} onCommit={(s) => editor.setCutEdge(c.id, "start", s)} />
              <span>–</span>
              <TimeInput label={t("editor.end")} value={c.endSec} onCommit={(s) => editor.setCutEdge(c.id, "end", s)} />
              <IconButton label={t("editor.setEndHere")} className="!h-5 !w-5 text-xs" onClick={() => editor.setCutEdge(c.id, "end", useEditor.getState().time)}>⇥</IconButton>
              <span className="ml-auto tabular-nums">{formatDuration(c.endSec - c.startSec)}</span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const PRESET_ORDER: PresetId[] = ["discord-20", "discord-20-av1", "nitro-basic-50", "nitro-500", "unlimited", "original"];

export function ExportPanel() {
  const { t } = useTranslation();
  const media = useEditor((s) => s.media);
  const cuts = useEditor((s) => s.cuts);
  const presetId = useEditor((s) => s.presetId);
  const mode = useEditor((s) => s.mode);
  const keepSeparate = useEditor((s) => s.keepSeparateTracks);
  const preset = PRESETS[presetId];
  const montage = mode === "montage" && preset.allowsMontage && cuts.length > 1;
  const groups = montage ? [cuts] : cuts.map((c) => [c]);
  const lowQuality = media !== null && groups.some((g) => planOutput(preset, media, totalDuration(g)).lowQuality);

  return (
    <Section title={t("export.title")}>
      <label className="mb-2 block text-xs text-neutral-500">
        {t("export.preset")}
        <select
          value={presetId}
          onChange={(e) => editor.setPreset(e.target.value as PresetId)}
          className="mt-0.5 block w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          {PRESET_ORDER.map((id) => <option key={id} value={id}>{t(`presets.${id}`)}</option>)}
        </select>
        <span className="mt-0.5 block">{t(`presetHints.${presetId}`)}</span>
      </label>

      <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-neutral-200 p-0.5 text-sm dark:bg-neutral-800" role="radiogroup" aria-label={t("export.mode")}>
        {(["separate", "montage"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={m === "montage" && !preset.allowsMontage}
            title={m === "montage" && !preset.allowsMontage ? t("export.montageUnavailable") : undefined}
            onClick={() => editor.setMode(m)}
            className={`rounded px-2 py-1 disabled:opacity-40 ${mode === m && (m === "separate" || preset.allowsMontage) ? "bg-white shadow-sm dark:bg-neutral-600" : ""}`}
          >
            {t(`export.${m}`)}
          </button>
        ))}
      </div>

      {preset.sizeLimitBytes === null && preset.codec !== "copy" && (
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepSeparate} onChange={(e) => editor.setKeepSeparateTracks(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          {t("export.keepTracks")}
        </label>
      )}

      {cuts.length > 0 && (
        <p className="mb-1 text-xs text-neutral-500">
          {t("export.summary", { count: cuts.length, duration: formatDuration(totalDuration(cuts)) })} → {t("export.files", { count: groups.length })}
        </p>
      )}
      {lowQuality && <p className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{t("export.lowQuality")}</p>}

      <Button variant="primary" className="w-full" disabled={cuts.length === 0} title={cuts.length === 0 ? t("export.nothing") : undefined} onClick={() => enqueueExport()}>
        {t("export.button")} <Kbd>Ctrl+E</Kbd>
      </Button>
      <ExportQueue />
    </Section>
  );
}

function ExportQueue() {
  const { t } = useTranslation();
  const jobs = useExports((s) => s.jobs);
  if (jobs.length === 0) return null;
  const anyFinished = jobs.some((j) => j.status !== "queued" && j.status !== "running");
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center">
        <h3 className="text-xs font-semibold text-neutral-500">{t("export.queue")}</h3>
        {anyFinished && <Button variant="ghost" className="ml-auto !py-0 text-xs" onClick={clearFinished}>{t("export.clear")}</Button>}
      </div>
      <ul className="space-y-1.5">
        {jobs.map((j) => <JobRow key={j.id} job={j} />)}
      </ul>
    </div>
  );
}

function JobRow({ job }: { job: ExportJob }) {
  const { t } = useTranslation();
  const status = {
    queued: t("export.queued"),
    running: `${t("export.running")}${job.pass > 1 ? ` · ${t("export.pass", { n: job.pass })}` : ""} · ${Math.round(job.progress * 100)}%`,
    done: t("export.done", { size: ((job.result?.bytes ?? 0) / 1e6).toFixed(1) }),
    failed: t("export.failed"),
    cancelled: t("export.cancelled"),
  }[job.status];
  return (
    <li className="rounded-md border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-medium" title={job.label}>{job.label}</span>
        {(job.status === "queued" || job.status === "running") && (
          <IconButton label={t("export.cancel")} className="!h-5 !w-5" onClick={() => void cancelJob(job.id)}>✕</IconButton>
        )}
      </div>
      {job.status === "running" && <div className="my-1"><ProgressBar value={job.progress} /></div>}
      <div className="flex items-center gap-2 text-neutral-500">
        <span className={job.status === "failed" ? "text-red-600" : job.status === "done" ? "text-emerald-600" : ""}>{status}</span>
        {job.result && job.result.attempts > 1 && <span>· {t("export.attempts", { n: job.result.attempts - 1 })}</span>}
        {job.result && (
          <button type="button" className="ml-auto text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => void revealItemInDir(job.result!.outPath)}>
            {t("export.showInFolder")}
          </button>
        )}
      </div>
      {job.error && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-red-600">{job.error}</pre>}
    </li>
  );
}
