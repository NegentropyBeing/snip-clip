import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatTimecode, previewZoom, zoomRegion, type Effect, type Zoom } from "../core";
import { playback } from "../editor/playback";
import { buildProxy } from "../editor/session";
import { editor, useEditor } from "../editor/store";
import { IconButton, Kbd } from "./common";
import { FrameBackIcon, FrameForwardIcon, PauseIcon, PlayIcon } from "./icons";

/** Box of the video element inside the player, for the zoom rectangle. */
type Box = { left: number; top: number; width: number; height: number };

/**
 * Zoomed preview by CSS (FR-76): the region is scaled up around the element's centre and everything
 * outside it is clipped, so the element keeps its layout box.
 */
function zoomStyle(z: Zoom): CSSProperties {
  const r = zoomRegion(z);
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  return {
    transform: `scale(${1 / r.width}) translate(${pct(0.5 - (r.left + r.width / 2))}, ${pct(0.5 - (r.top + r.height / 2))})`,
    clipPath: `inset(${pct(r.top)} ${pct(1 - r.left - r.width)} ${pct(1 - r.top - r.height)} ${pct(r.left)})`,
  };
}

export function Player() {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  const src = useEditor((s) => s.video.src);
  const video = useEditor((s) => s.video);
  const audio = useEditor((s) => s.audio);
  const codec = useEditor((s) => s.media?.videoCodec ?? "");
  const cuts = useEditor((s) => s.cuts);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedEffectId = useEditor((s) => s.selectedEffectId);
  const { zoom, editing } = previewZoom({ cuts, time, playing, selectedId, selectedEffectId });
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    playback.attach(el);
    return () => playback.detach(el);
  }, []);

  // The video is centred and letterboxed by layout; the rectangle follows its box.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    el.addEventListener("loadedmetadata", measure);
    measure();
    return () => {
      ro.disconnect();
      el.removeEventListener("loadedmetadata", measure);
    };
  }, []);

  // A source that loads but never yields a frame is as undecodable as one that errors.
  const onLoadedData = () => {
    if (ref.current && ref.current.videoWidth === 0) void buildProxy();
  };

  const notices: { text: string; tone: "info" | "warn" | "error" }[] = [];
  if (audio.status === "extracting") notices.push({ text: t("player.preparingAudio", { pct: Math.round(audio.progress * 100) }), tone: "info" });
  if (audio.status === "failed") notices.push({ text: t("player.audioFailed", { error: audio.error }), tone: "error" });
  if (video.source === "building") notices.push({ text: t("player.buildingProxy", { codec: codec.toUpperCase(), pct: Math.round(video.progress * 100) }), tone: "warn" });
  if (video.source === "proxy") notices.push({ text: t("player.proxyActive"), tone: "info" });
  if (video.source === "failed") notices.push({ text: t("player.proxyFailed", { error: video.error }), tone: "error" });

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        ref={ref}
        src={src ?? undefined}
        className="max-h-full max-w-full"
        style={zoom ? zoomStyle(zoom) : undefined}
        preload="auto"
        playsInline
        onClick={() => playback.toggle()}
        onError={() => void buildProxy()}
        onLoadedData={onLoadedData}
      />
      {editing && box && box.width > 0 && <ZoomEditor box={box} cutId={editing.cutId} effect={editing.effect} />}
      {notices.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 p-2">
          {notices.map((n) => (
            <div
              key={n.text}
              className={`max-w-xl rounded-md px-3 py-1.5 text-center text-xs shadow ${
                n.tone === "error" ? "bg-red-600/90 text-white" : n.tone === "warn" ? "bg-amber-500/90 text-black" : "bg-neutral-900/80 text-neutral-100"
              }`}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Editing the zoom (FR-74): the whole frame with the region's rectangle. Clicking sets the centre,
 * dragging the rectangle moves it; the store keeps the region inside the frame.
 */
function ZoomEditor({ box, cutId, effect }: { box: Box; cutId: string; effect: Effect }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // Offset from the pointer to the centre while dragging, so the rectangle does not jump.
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const zoom = effect.zoom!;
  const r = zoomRegion(zoom);
  const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

  const pointAt = (e: ReactPointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  const moveTo = (x: number, y: number) => editor.setEffectZoom(cutId, effect.id, { ...zoom, x, y });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointAt(e);
    if ((e.target as HTMLElement).closest("[data-zoom-rect]")) {
      drag.current = { dx: p.x - centre.x, dy: p.y - centre.y };
    } else {
      drag.current = { dx: 0, dy: 0 };
      moveTo(p.x, p.y);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = pointAt(e);
    moveTo(p.x - d.dx, p.y - d.dy);
  };

  return (
    <div
      ref={ref}
      className="absolute cursor-crosshair touch-none overflow-hidden"
      style={box}
      title={t("player.zoomHint")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div
        data-zoom-rect
        className="absolute cursor-move border-2 border-amber-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{ left: `${r.left * 100}%`, top: `${r.top * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}
      />
    </div>
  );
}

export function Transport() {
  const { t } = useTranslation();
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const duration = useEditor((s) => s.media?.durationSec ?? 0);
  const markIn = useEditor((s) => s.markIn);
  const markOut = useEditor((s) => s.markOut);

  return (
    <div className="flex items-center gap-1 border-t border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
      <IconButton label={`${t("player.frameBack")} (←)`} onClick={() => playback.step(-1)}><FrameBackIcon /></IconButton>
      <button
        type="button"
        title={`${playing ? t("player.pause") : t("player.play")} (Space)`}
        aria-label={playing ? t("player.pause") : t("player.play")}
        onClick={() => playback.toggle()}
        className="bg-brand-gradient mx-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-lg text-white shadow-sm transition hover:brightness-110"
      >
        {playing ? <PauseIcon /> : <span className="translate-x-px"><PlayIcon /></span>}
      </button>
      <IconButton label={`${t("player.frameForward")} (→)`} onClick={() => playback.step(1)}><FrameForwardIcon /></IconButton>
      <span className="ml-2 font-mono text-sm tabular-nums">
        {formatTimecode(time)} <span className="text-neutral-400">/ {formatTimecode(duration)}</span>
      </span>
      {playing && rate !== 1 && <span className="ml-2 rounded bg-brand-gradient px-1.5 text-xs font-semibold text-white">{rate}×</span>}
      <div className="ml-auto flex items-center gap-1.5 text-xs">
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.markIn(time)} title={t("player.markIn")}>
          <Kbd>I</Kbd>
          <span className="font-mono tabular-nums text-neutral-500">{markIn === null ? "--:--" : formatTimecode(markIn)}</span>
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.markOut(time)} title={t("player.markOut")}>
          <Kbd>O</Kbd>
          <span className="font-mono tabular-nums text-neutral-500">{markOut === null ? "--:--" : formatTimecode(markOut)}</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
          disabled={markIn === null && markOut === null}
          onClick={() => editor.confirmMarks()}
          title={t("player.confirm")}
        >
          <Kbd>Enter</Kbd>
          <span>{t("player.confirm")}</span>
        </button>
      </div>
    </div>
  );
}
