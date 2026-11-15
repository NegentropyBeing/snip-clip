import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import {
  cutMix, DEFAULT_ZOOM, EFFECT_SPEEDS, MAX_ZOOM, MIN_ZOOM, effectSlot, exportDuration, hasEffects, hasOverride, outputDuration, planOutput, PRESET_ORDER, PRESETS,
  type AudioTrack, type Cut, type PresetId, type TrackMix,
} from "../core";
import { cancelJob, clearFinished, copyToClipboard, enqueueExport, useExports, type ExportJob } from "../editor/exportQueue";
import { playback } from "../editor/playback";
import { editor, useEditor } from "../editor/store";
import { Button, formatDuration, formatSpeed, IconButton, Kbd, ProgressBar, selectClass, TimeInput } from "./common";
import { CloseIcon, DownIcon, MixerIcon, ResetIcon, SlowIcon, ToEndIcon, ToStartIcon, UpIcon } from "./icons";

const NO_TRACKS: AudioTrack[] = [];

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

const trackName = (t: TFunction, tr: AudioTrack) => tr.title ?? t("editor.track", { n: tr.index + 1 });

/** "Video | This cut": which mix the Tracks panel edits (FR-50). */
function ScopeSwitch({ cut, onChange }: { cut: boolean; onChange: (cut: boolean) => void }) {
  const { t } = useTranslation();
  const item = (active: boolean) =>
    `px-2 py-0.5 ${active ? "bg-brand-500 text-white" : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"}`;
  return (
    <div role="radiogroup" aria-label={t("editor.mixScope")} className="flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
      <button type="button" role="radio" aria-checked={!cut} className={item(!cut)} onClick={() => onChange(false)}>{t("editor.scopeVideo")}</button>
      <button type="button" role="radio" aria-checked={cut} className={item(cut)} onClick={() => onChange(true)}>{t("editor.scopeCut")}</button>
    </div>
  );
}

export function TrackMixer() {
  const { t } = useTranslation();
  const tracks = useEditor((s) => s.media?.audioTracks ?? []);
  const mix = useEditor((s) => s.mix);
  const selected = useEditor((s) => s.cuts.find((c) => c.id === s.selectedId) ?? null);
  // The cut being edited; selecting another cut goes back to the video's mix.
  const [scopeCutId, setScopeCutId] = useState<string | null>(null);
  const cut = selected && scopeCutId === selected.id ? selected : null;
  const shown = cut ? cutMix(mix, cut) : mix;
  const setTrack = (index: number, patch: Partial<TrackMix>) =>
    cut ? editor.setCutTrack(cut.id, index, patch) : editor.setTrack(index, patch);

  return (
    <Section
      title={t("editor.tracks")}
      action={selected && tracks.length > 0 && <ScopeSwitch cut={cut !== null} onChange={(c) => setScopeCutId(c ? selected.id : null)} />}
    >
      {tracks.length === 0 && <p className="text-sm text-neutral-500">{t("editor.noTracks")}</p>}
      {cut && <p className="mb-1 text-xs text-neutral-500">{t("editor.cutScopeHint")}</p>}
      <ul className={`space-y-1 ${cut ? "border-l-2 border-brand-400 pl-2" : ""}`}>
        {tracks.map((tr) => {
          const m = shown[tr.index] ?? { enabled: true, volume: 1 };
          const own = cut?.override?.[tr.index] !== undefined;
          const follows = cut !== null && !own;
          const faded = follows ? (m.enabled ? "opacity-60" : "opacity-35") : m.enabled ? "" : "opacity-50";
          return (
            <li key={tr.index} className={`flex items-center gap-2 ${faded}`} title={follows ? t("editor.followsVideo") : undefined}>
              <input
                type="checkbox"
                checked={m.enabled}
                title={t("editor.trackToggle")}
                onChange={(e) => setTrack(tr.index, { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="w-24 truncate text-sm" title={tr.title ?? undefined}>{trackName(t, tr)}</span>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(m.volume * 100)}
                disabled={!m.enabled}
                title={t("editor.volumeReset")}
                onChange={(e) => setTrack(tr.index, { volume: Number(e.target.value) / 100 })}
                onDoubleClick={() => setTrack(tr.index, { volume: 1 })}
                className="min-w-0 flex-1"
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-neutral-500">{Math.round(m.volume * 100)}%</span>
              {cut && (
                <IconButton label={t("editor.followVideo")} className="!h-5 !w-5 text-xs" disabled={!own} onClick={() => editor.resetCutTrack(cut.id, tr.index)}>
                  <ResetIcon />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** "Discord off, Game 60%": what a cut's override changes (FR-51). */
function overrideSummary(t: TFunction, tracks: readonly AudioTrack[], cut: Cut): string {
  return tracks
    .filter((tr) => cut.override?.[tr.index])
    .map((tr) => {
      const m = cut.override![tr.index];
      return m.enabled ? t("editor.overrideVolume", { name: trackName(t, tr), pct: Math.round(m.volume * 100) }) : t("editor.overrideOff", { name: trackName(t, tr) });
    })
    .join(", ");
}

/** "2 effects: 0.5×, 0.25×": the effects of a cut and their speeds (FR-65). */
function effectSummary(t: TFunction, language: string, cut: Cut): string {
  const effects = cut.effects ?? [];
  // Slow speeds first, then the zoom levels (FR-75): "2 effects: 0.5×, zoom 2×".
  const speeds = [...new Set(effects.map((e) => e.speed).filter((s) => s !== 1))].sort((a, b) => b - a).map((s) => formatSpeed(s, language));
  const zooms = [...new Set(effects.flatMap((e) => (e.zoom ? [e.zoom.level] : [])))].sort((a, b) => a - b)
    .map((l) => t("effects.zoomLevel", { level: formatSpeed(l, language) }));
  const parts = [...speeds, ...zooms];
  return t("effects.summary", { count: effects.length, speeds: parts.length > 0 ? parts.join(", ") : formatSpeed(1, language) });
}

export function CutList() {
  const { t, i18n } = useTranslation();
  const cuts = useEditor((s) => s.cuts);
  const selectedId = useEditor((s) => s.selectedId);
  const duration = useEditor((s) => s.media?.durationSec ?? 0);
  const tracks = useEditor((s) => s.media?.audioTracks ?? NO_TRACKS);

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
              c.id === selectedId ? "border-brand-400 bg-brand-50 dark:bg-brand-400/10" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center gap-1">
              <span className="w-5 text-xs font-semibold text-neutral-500">{i + 1}</span>
              <input
                value={c.name}
                placeholder={t("editor.cutName")}
                onChange={(e) => editor.updateCut(c.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-neutral-300 focus:border-brand-500 focus:outline-none dark:hover:border-neutral-600"
              />
              <IconButton label={t("editor.moveUp")} disabled={i === 0} onClick={(e) => { e.stopPropagation(); editor.moveCut(c.id, -1); }}><UpIcon /></IconButton>
              <IconButton label={t("editor.moveDown")} disabled={i === cuts.length - 1} onClick={(e) => { e.stopPropagation(); editor.moveCut(c.id, 1); }}><DownIcon /></IconButton>
              <IconButton label={`${t("editor.remove")} (Delete)`} onClick={(e) => { e.stopPropagation(); editor.removeCut(c.id); }}><CloseIcon /></IconButton>
            </div>
            <div className="mt-0.5 flex items-center gap-0.5 pl-5 text-xs text-neutral-500" onClick={(e) => e.stopPropagation()}>
              <IconButton label={t("editor.setStartHere")} className="!h-5 !w-5 text-xs" onClick={() => editor.setCutEdge(c.id, "start", useEditor.getState().time)}><ToStartIcon /></IconButton>
              <TimeInput label={t("editor.start")} value={c.startSec} onCommit={(s) => editor.setCutEdge(c.id, "start", s)} />
              <span>–</span>
              <TimeInput label={t("editor.end")} value={c.endSec} onCommit={(s) => editor.setCutEdge(c.id, "end", s)} />
              <IconButton label={t("editor.setEndHere")} className="!h-5 !w-5 text-xs" onClick={() => editor.setCutEdge(c.id, "end", useEditor.getState().time)}><ToEndIcon /></IconButton>
              {/* The length in the exported file: effects make it longer (FR-65). */}
              <span className="ml-auto tabular-nums" title={t("editor.outputDuration")}>{formatDuration(outputDuration(c))}</span>
            </div>
            {hasOverride(c) && (
              <div
                className="mt-0.5 ml-5 flex min-w-0 items-center gap-1 rounded bg-brand-50 pl-1 text-xs text-brand-700 dark:bg-brand-400/10 dark:text-brand-300"
                title={overrideSummary(t, tracks, c)}
                onClick={(e) => e.stopPropagation()}
              >
                <MixerIcon />
                <span className="min-w-0 flex-1 truncate">{overrideSummary(t, tracks, c)}</span>
                <IconButton label={t("editor.removeOverride")} className="!h-5 !w-5 text-xs" onClick={() => editor.resetCutTrack(c.id)}><CloseIcon /></IconButton>
              </div>
            )}
            {hasEffects(c) && (
              <div
                className="mt-0.5 ml-5 flex min-w-0 items-center gap-1 rounded bg-amber-50 pl-1 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"
                title={effectSummary(t, i18n.language, c)}
                onClick={(e) => e.stopPropagation()}
              >
                <SlowIcon />
                <span className="min-w-0 flex-1 truncate">{effectSummary(t, i18n.language, c)}</span>
                <IconButton label={t("effects.removeAll")} className="!h-5 !w-5 text-xs" onClick={() => editor.clearEffects(c.id)}><CloseIcon /></IconButton>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Effects of the selected cut: "Add effect" (FR-62) and the selected effect's start, end and speed (FR-63). */
export function EffectPanel() {
  const { t, i18n } = useTranslation();
  const cut = useEditor((s) => s.cuts.find((c) => c.id === s.selectedId) ?? null);
  const selectedEffectId = useEditor((s) => s.selectedEffectId);
  const canAdd = useEditor((s) => {
    const c = s.cuts.find((x) => x.id === s.selectedId);
    return c !== undefined && effectSlot(c, s.time) !== null;
  });
  if (!cut) return null;
  const effect = cut.effects?.find((e) => e.id === selectedEffectId) ?? null;
  const speeds = effect && !EFFECT_SPEEDS.includes(effect.speed) ? [...EFFECT_SPEEDS, effect.speed] : EFFECT_SPEEDS;

  return (
    <Section
      title={t("effects.title")}
      action={
        <Button variant="ghost" className="!py-0.5 text-xs" disabled={!canAdd} title={canAdd ? undefined : t("effects.cannotAdd")} onClick={() => editor.addEffect()}>
          + {t("effects.add")} <Kbd>E</Kbd>
        </Button>
      }
    >
      {!effect && <p className="text-xs text-neutral-500">{hasEffects(cut) ? t("effects.selectHint") : t("effects.none")}</p>}
      {effect && (
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <TimeInput label={t("editor.start")} value={effect.startSec} onCommit={(s) => editor.setEffectEdge(cut.id, effect.id, "start", s)} />
          <span>–</span>
          <TimeInput label={t("editor.end")} value={effect.endSec} onCommit={(s) => editor.setEffectEdge(cut.id, effect.id, "end", s)} />
          <select
            aria-label={t("effects.speed")}
            title={t("effects.speed")}
            value={effect.speed}
            onChange={(e) => editor.setEffectSpeed(cut.id, effect.id, Number(e.target.value))}
            className={`${selectClass} ml-auto !py-0.5 !text-xs`}
          >
            {speeds.map((s) => <option key={s} value={s}>{formatSpeed(s, i18n.language)}</option>)}
          </select>
          <IconButton label={`${t("effects.remove")} (Delete)`} className="!h-6 !w-6" onClick={() => editor.removeEffect(cut.id, effect.id)}><CloseIcon /></IconButton>
        </div>
      )}
      {effect && (
        <div className="mt-1.5 space-y-1 text-xs">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={effect.zoom !== undefined}
              onChange={(e) => {
                editor.setEffectZoom(cut.id, effect.id, e.target.checked ? DEFAULT_ZOOM : null);
                // The rectangle shows while paused inside the effect (FR-76): bring the playhead there.
                const now = useEditor.getState().time;
                if (e.target.checked && (now < effect.startSec || now >= effect.endSec)) {
                  playback.pause();
                  playback.seek(effect.startSec);
                }
              }}
              className="h-4 w-4"
            />
            {t("effects.zoom")}
          </label>
          {effect.zoom && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.1}
                  value={effect.zoom.level}
                  aria-label={t("effects.zoomLevelLabel")}
                  title={t("effects.zoomLevelLabel")}
                  onChange={(e) => editor.setEffectZoom(cut.id, effect.id, { ...effect.zoom!, level: Number(e.target.value) })}
                  className="min-w-0 flex-1"
                />
                <span className="w-10 text-right font-mono tabular-nums text-neutral-500">{formatSpeed(effect.zoom.level, i18n.language)}</span>
              </div>
              <p className="text-neutral-500">{t("effects.zoomHint")}</p>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

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
  // Budget and warning use the length of the exported file (FR-69).
  const lowQuality = media !== null && groups.some((g) => planOutput(preset, media, exportDuration(g, preset)).lowQuality);
  const ignoresEffects = preset.codec === "copy" && cuts.some(hasEffects);

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
          <input type="checkbox" checked={keepSeparate} onChange={(e) => editor.setKeepSeparateTracks(e.target.checked)} className="h-4 w-4" />
          {t("export.keepTracks")}
        </label>
      )}

      {cuts.length > 0 && (
        <p className="mb-1 text-xs text-neutral-500">
          {t("export.summary", { count: cuts.length, duration: formatDuration(exportDuration(cuts, preset)) })} → {t("export.files", { count: groups.length })}
        </p>
      )}
      {ignoresEffects && <p className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{t("export.effectsIgnored")}</p>}
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
          <IconButton label={t("export.cancel")} className="!h-5 !w-5" onClick={() => void cancelJob(job.id)}><CloseIcon /></IconButton>
        )}
      </div>
      {job.status === "running" && <div className="my-1"><ProgressBar value={job.progress} /></div>}
      <div className="flex items-center gap-2 text-neutral-500">
        <span className={job.status === "failed" ? "text-red-600" : job.status === "done" ? "text-brand-600 dark:text-brand-400" : ""}>{status}</span>
        {job.result && job.result.attempts > 1 && <span>· {t("export.attempts", { n: job.result.attempts - 1 })}</span>}
        {job.result && (
          <span className="ml-auto flex gap-2">
            <button type="button" className="text-brand2-600 hover:underline dark:text-brand2-400" onClick={() => void copyToClipboard([job.result!.outPath])}>
              {t("export.copy")}
            </button>
            <button type="button" className="text-brand2-600 hover:underline dark:text-brand2-400" onClick={() => void revealItemInDir(job.result!.outPath)}>
              {t("export.showInFolder")}
            </button>
          </span>
        )}
      </div>
      {job.error && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-red-600">{job.error}</pre>}
    </li>
  );
}
