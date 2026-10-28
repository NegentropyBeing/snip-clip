import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { envelopeColumns, formatTimecode, laneHeight, mixEnvelope, normalizeCut, type AudioTrack, type Cut } from "../core";
import { updateSettings, useApp } from "../editor/app";
import { playback } from "../editor/playback";
import { editor, useEditor } from "../editor/store";
import { IconButton } from "./common";
import { MinusIcon, PlusIcon } from "./icons";

const RULER_H = 20;
/** Height of the waveform area in mix view; per-track lanes share at least this much. */
const WAVE_H = 72;
const DRAG_THRESHOLD_PX = 4;
const NO_TRACKS: AudioTrack[] = [];
const MAX_PPS = 400;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MIN_TICK_PX = 70;

type Drag =
  | { kind: "create"; startX: number; startSec: number; moved: boolean }
  | { kind: "scrub" }
  | { kind: "move"; id: string; base: Cut; startSec: number; moved: boolean }
  | { kind: "edge"; id: string; edge: "start" | "end" };

export function Timeline() {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollX, setScrollX] = useState(0);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);

  const duration = useEditor((s) => s.media?.durationSec ?? 0);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const cuts = useEditor((s) => s.cuts);
  const selectedId = useEditor((s) => s.selectedId);
  const markIn = useEditor((s) => s.markIn);
  const markOut = useEditor((s) => s.markOut);
  const zoom = useEditor((s) => s.zoom);
  const envelopes = useEditor((s) => s.envelopes);
  const mix = useEditor((s) => s.mix);
  const tracks = useEditor((s) => s.media?.audioTracks ?? NO_TRACKS);
  const waveformView = useApp((s) => s.settings.waveform);
  const perTrack = waveformView === "tracks" && tracks.length > 1;
  const laneH = perTrack ? laneHeight(tracks.length, WAVE_H) : WAVE_H;
  const TRACK_H = perTrack ? laneH * tracks.length : WAVE_H;

  const fitPps = duration > 0 ? viewW / duration : 1;
  const pps = zoom > 0 ? Math.max(zoom, fitPps) : fitPps;
  const contentW = Math.max(viewW, duration * pps);
  const env = useMemo(() => (perTrack ? null : mixEnvelope(envelopes, mix)), [perTrack, envelopes, mix]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Waveform of the current mix, or one lane per track, drawn only for the visible window.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(TRACK_H * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (duration === 0) return;
    const cols = Math.max(1, Math.floor(viewW));
    const from = scrollX / pps;
    const style = getComputedStyle(c);
    const color = style.getPropertyValue("--waveform") || "#6366f1";
    const muted = style.getPropertyValue("--waveform-muted") || "#888";

    const draw = (data: Float32Array, gain: number, top: number, height: number) => {
      const peaks = envelopeColumns(data, from, from + viewW / pps, cols);
      const mid = top + height / 2;
      for (let i = 0; i < cols; i++) {
        // sqrt lifts quiet game audio into view without flattening loud peaks.
        const h = Math.max(dpr * 0.5, Math.sqrt(Math.min(1, peaks[i] * gain)) * (height / 2) * 0.9);
        g.fillRect(i * dpr, mid - h, Math.max(1, dpr), h * 2);
      }
    };

    if (env) {
      if (env.length === 0) return;
      g.fillStyle = color;
      draw(env, 1, 0, c.height);
      return;
    }
    const lane = laneH * dpr;
    tracks.forEach((tr, i) => {
      const data = envelopes[tr.index];
      const m = mix[tr.index] ?? { enabled: true, volume: 1 };
      if (i > 0) {
        g.fillStyle = muted;
        g.globalAlpha = 0.35;
        g.fillRect(0, Math.round(i * lane), c.width, Math.max(1, Math.round(dpr / 2)));
      }
      if (!data) return;
      // Enabled tracks show their level after the volume; excluded ones stay faint at their own level.
      g.fillStyle = m.enabled ? color : muted;
      g.globalAlpha = m.enabled ? 1 : 0.45;
      draw(data, m.enabled ? m.volume : 1, i * lane, lane);
    });
    g.globalAlpha = 1;
  }, [env, envelopes, mix, tracks, laneH, TRACK_H, scrollX, pps, viewW, duration]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
  }, [time, pps, playing]);

  const secAt = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft;
    return Math.min(duration, Math.max(0, x / pps));
  };

  const zoomAround = (factor: number, clientX?: number) => {
    const el = scroller.current;
    if (!el || duration === 0) return;
    const anchorSec = clientX === undefined ? time : secAt(clientX);
    const anchorOffset = anchorSec * pps - el.scrollLeft;
    const next = Math.min(MAX_PPS, Math.max(fitPps, pps * factor));
    editor.setZoom(next <= fitPps * 1.001 ? 0 : next);
    requestAnimationFrame(() => {
      el.scrollLeft = anchorSec * next - anchorOffset;
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration === 0) return;
    const target = e.target as HTMLElement;
    const cutEl = target.closest<HTMLElement>("[data-cut]");
    const edge = target.dataset.edge as "start" | "end" | undefined;
    const sec = secAt(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (cutEl) {
      const id = cutEl.dataset.cut!;
      editor.select(id);
      const base = useEditor.getState().cuts.find((c) => c.id === id)!;
      drag.current = edge ? { kind: "edge", id, edge } : { kind: "move", id, base, startSec: sec, moved: false };
    } else if (target.closest("[data-ruler]")) {
      drag.current = { kind: "scrub" };
      playback.seek(sec);
    } else {
      drag.current = { kind: "create", startX: e.clientX, startSec: sec, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const sec = secAt(e.clientX);
    switch (d.kind) {
      case "scrub":
        playback.seek(sec);
        break;
      case "create":
        if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        setDraft({ a: d.startSec, b: sec });
        break;
      case "move":
        if (!d.moved && Math.abs(sec - d.startSec) * pps < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        editor.shiftCut(d.id, d.base, sec - d.startSec);
        break;
      case "edge":
        editor.setCutEdge(d.id, d.edge, sec);
        // Show the frame at the edge being dragged.
        playback.seek(sec);
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "create") {
      setDraft(null);
      if (d.moved) editor.addCut(d.startSec, secAt(e.clientX));
      else {
        editor.select(null);
        playback.seek(d.startSec);
      }
    } else if (d.kind === "move" && !d.moved) {
      playback.seek(d.base.startSec);
    }
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      zoomAround(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroller.current) {
      scroller.current.scrollLeft += e.deltaY;
    }
  };

  // Ctrl+wheel must not zoom the whole WebView.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const block = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, []);

  const step = TICK_STEPS.find((s) => s * pps >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const firstTick = Math.floor(scrollX / pps / step) * step;
  const ticks: number[] = [];
  for (let s = firstTick; s <= Math.min(duration, (scrollX + viewW) / pps + step); s += step) ticks.push(s);

  const pending = markIn !== null || markOut !== null ? normalizeCut({ id: "", name: "", startSec: markIn ?? 0, endSec: markOut ?? time }, duration) : null;
  const showPending = pending && markIn !== null && (markOut !== null || time > markIn);

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-1 px-3 pt-1 text-xs text-neutral-500">
        <span>{t("timeline.hint")}</span>
        <div className="ml-auto flex items-center">
          {tracks.length > 1 && (
            <div className="mr-2 grid grid-cols-2 rounded-md bg-neutral-200 p-0.5 dark:bg-neutral-800" role="radiogroup" aria-label={t("timeline.waveform")}>
              {(["mix", "tracks"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={waveformView === v}
                  title={t(`timeline.${v}Hint`)}
                  onClick={() => void updateSettings({ waveform: v })}
                  className={`rounded px-2 py-0.5 ${waveformView === v ? "bg-white text-neutral-800 shadow-sm dark:bg-neutral-600 dark:text-neutral-100" : ""}`}
                >
                  {t(`timeline.${v}`)}
                </button>
              ))}
            </div>
          )}
          <IconButton label={t("timeline.zoomOut")} onClick={() => zoomAround(0.67)}><MinusIcon /></IconButton>
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.setZoom(0)}>
            {t("timeline.fit")}
          </button>
          <IconButton label={t("timeline.zoomIn")} onClick={() => zoomAround(1.5)}><PlusIcon /></IconButton>
        </div>
      </div>
      <div
        ref={scroller}
        className="relative overflow-x-auto overflow-y-hidden"
        style={{ height: RULER_H + TRACK_H + 14 }}
        onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
        onWheel={onWheel}
      >
        <div className="relative" style={{ width: contentW, height: RULER_H + TRACK_H }}>
          <div data-ruler className="absolute inset-x-0 top-0 cursor-ew-resize border-b border-neutral-200 dark:border-neutral-800" style={{ height: RULER_H }}>
            {ticks.map((s) => (
              <div key={s} className="absolute top-0 h-full border-l border-neutral-300 pl-1 text-[10px] leading-5 text-neutral-500 dark:border-neutral-700" style={{ left: s * pps }}>
                {formatTimecode(s).replace(/\.000$/, "")}
              </div>
            ))}
          </div>

          <canvas
            ref={canvas}
            className="pointer-events-none absolute"
            style={{ left: scrollX, top: RULER_H, width: viewW, height: TRACK_H }}
          />

          {cuts.map((c, i) => (
            <div
              key={c.id}
              data-cut={c.id}
              className={`absolute cursor-grab rounded-sm border-2 active:cursor-grabbing ${
                c.id === selectedId ? "border-brand-400 bg-brand-400/30" : "border-brand2-400/80 bg-brand2-400/15 hover:bg-brand2-400/25"
              }`}
              style={{ left: c.startSec * pps, width: Math.max(2, (c.endSec - c.startSec) * pps), top: RULER_H + 2, height: TRACK_H - 4 }}
            >
              <span className="pointer-events-none absolute left-1 top-0.5 max-w-full truncate pr-2 text-[11px] font-semibold text-neutral-800 dark:text-neutral-100">
                {i + 1}{c.name ? ` · ${c.name}` : ""}
              </span>
              <div data-edge="start" className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize" />
              <div data-edge="end" className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize" />
            </div>
          ))}

          {draft && (
            <div
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-brand-400 bg-brand-400/15"
              style={{ left: Math.min(draft.a, draft.b) * pps, width: Math.abs(draft.b - draft.a) * pps, top: RULER_H + 2, height: TRACK_H - 4 }}
            />
          )}

          {showPending && pending && (
            <div
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-brand2-400 bg-brand2-400/10"
              style={{ left: pending.startSec * pps, width: (pending.endSec - pending.startSec) * pps, top: RULER_H + 2, height: TRACK_H - 4 }}
            />
          )}
          {markIn !== null && <div className="pointer-events-none absolute w-0.5 bg-brand-400" style={{ left: markIn * pps, top: RULER_H, height: TRACK_H }} />}
          {markOut !== null && <div className="pointer-events-none absolute w-0.5 bg-brand2-400" style={{ left: markOut * pps, top: RULER_H, height: TRACK_H }} />}

          <div className="pointer-events-none absolute top-0 w-px bg-red-500" style={{ left: time * pps, height: RULER_H + TRACK_H }}>
            <div className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
          </div>

          {/* Track names stay at the left edge while scrolling; a click includes or excludes the track. */}
          {perTrack && tracks.map((tr, i) => {
            const m = mix[tr.index] ?? { enabled: true, volume: 1 };
            return (
              <button
                key={tr.index}
                type="button"
                title={t("editor.trackToggle")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => editor.setTrack(tr.index, { enabled: !m.enabled })}
                className={`absolute z-10 max-w-40 truncate rounded bg-neutral-50/85 px-1 text-left text-[10px] leading-4 font-medium hover:bg-neutral-50 dark:bg-neutral-900/85 dark:hover:bg-neutral-900 ${
                  m.enabled ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-400 line-through dark:text-neutral-500"
                }`}
                style={{ left: scrollX + 4, top: RULER_H + i * laneH + 2 }}
              >
                {tr.title ?? t("editor.track", { n: tr.index + 1 })}
                {m.enabled && m.volume !== 1 && <span className="ml-1 font-mono text-neutral-500">{Math.round(m.volume * 100)}%</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
