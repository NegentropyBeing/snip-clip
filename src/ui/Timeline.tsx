import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { envelopeColumns, formatTimecode, mixEnvelope, normalizeCut, type Cut } from "../core";
import { playback } from "../editor/playback";
import { editor, useEditor } from "../editor/store";
import { IconButton } from "./common";

const RULER_H = 20;
const TRACK_H = 72;
const DRAG_THRESHOLD_PX = 4;
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

  const fitPps = duration > 0 ? viewW / duration : 1;
  const pps = zoom > 0 ? Math.max(zoom, fitPps) : fitPps;
  const contentW = Math.max(viewW, duration * pps);
  const env = useMemo(() => mixEnvelope(envelopes, mix), [envelopes, mix]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Waveform of the current mix, drawn only for the visible window.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(TRACK_H * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (env.length === 0 || duration === 0) return;
    const cols = Math.max(1, Math.floor(viewW));
    const from = scrollX / pps;
    const peaks = envelopeColumns(env, from, from + viewW / pps, cols);
    g.fillStyle = getComputedStyle(c).getPropertyValue("--waveform") || "#6366f1";
    const mid = c.height / 2;
    for (let i = 0; i < cols; i++) {
      // sqrt lifts quiet game audio into view without flattening loud peaks.
      const h = Math.max(dpr * 0.5, Math.sqrt(peaks[i]) * mid * 0.95);
      g.fillRect(i * dpr, mid - h, Math.max(1, dpr), h * 2);
    }
  }, [env, scrollX, pps, viewW, duration]);

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
          <IconButton label={t("timeline.zoomOut")} onClick={() => zoomAround(0.67)}>−</IconButton>
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.setZoom(0)}>
            {t("timeline.fit")}
          </button>
          <IconButton label={t("timeline.zoomIn")} onClick={() => zoomAround(1.5)}>+</IconButton>
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
                c.id === selectedId ? "border-amber-400 bg-amber-400/25" : "border-indigo-400/80 bg-indigo-400/15 hover:bg-indigo-400/25"
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
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-amber-400 bg-amber-400/15"
              style={{ left: Math.min(draft.a, draft.b) * pps, width: Math.abs(draft.b - draft.a) * pps, top: RULER_H + 2, height: TRACK_H - 4 }}
            />
          )}

          {showPending && pending && (
            <div
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-emerald-500 bg-emerald-500/10"
              style={{ left: pending.startSec * pps, width: (pending.endSec - pending.startSec) * pps, top: RULER_H + 2, height: TRACK_H - 4 }}
            />
          )}
          {markIn !== null && <div className="pointer-events-none absolute w-0.5 bg-emerald-500" style={{ left: markIn * pps, top: RULER_H, height: TRACK_H }} />}
          {markOut !== null && <div className="pointer-events-none absolute w-0.5 bg-rose-500" style={{ left: markOut * pps, top: RULER_H, height: TRACK_H }} />}

          <div className="pointer-events-none absolute top-0 w-px bg-red-500" style={{ left: time * pps, height: RULER_H + TRACK_H }}>
            <div className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
