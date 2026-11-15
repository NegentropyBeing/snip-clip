// Zoom (spec §19): an effect can show an enlarged region of the frame. The region keeps the video's
// aspect ratio and stays inside the frame; it is fixed for the whole effect.
import { cutAt } from "./cutOverride";
import { effectAt } from "./effects";
import type { Cut, Effect, Zoom } from "./types";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Level when the Zoom option is turned on (FR-74). */
export const DEFAULT_ZOOM: Zoom = { x: 0.5, y: 0.5, level: 2 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const even = (n: number) => 2 * Math.floor(n / 2);

/** Level within 1×–4×, and the centre moved so the region stays fully inside the frame (FR-72). */
export function clampZoom(z: Zoom): Zoom {
  const level = clamp(z.level, MIN_ZOOM, MAX_ZOOM);
  const half = 0.5 / level;
  return { x: clamp(z.x, half, 1 - half), y: clamp(z.y, half, 1 - half), level };
}

/** The part of the frame shown, as fractions of its width and height. */
export function zoomRegion(z: Zoom): { left: number; top: number; width: number; height: number } {
  const c = clampZoom(z);
  const size = 1 / c.level;
  return { left: c.x - size / 2, top: c.y - size / 2, width: size, height: size };
}

/** The region in source pixels for FFmpeg's crop: even sizes and offsets (4:2:0 chroma), inside the frame. */
export function cropRect(z: Zoom, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const c = clampZoom(z);
  const w = Math.max(2, even(width / c.level));
  const h = Math.max(2, even(height / c.level));
  const x = clamp(even(Math.round(c.x * width - w / 2)), 0, even(width - w));
  const y = clamp(even(Math.round(c.y * height - h / 2)), 0, even(height - h));
  return { x, y, w, h };
}

/** Turns an effect's zoom on (clamped) or, with null, off (FR-74). */
export function setEffectZoom(cut: Cut, id: string, zoom: Zoom | null): Cut {
  if (!cut.effects) return cut;
  return {
    ...cut,
    effects: cut.effects.map((e) => {
      if (e.id !== id) return e;
      const { zoom: _, ...rest } = e;
      return zoom ? { ...rest, zoom: clampZoom(zoom) } : rest;
    }),
  };
}

/** Preview zoom at `sec`: the effect's in the playing cut, by the rule of FR-52 (FR-76). */
export function zoomAt(cuts: readonly Cut[], sec: number, selectedId: string | null): Zoom | null {
  return effectAt(cutAt(cuts, sec, selectedId), sec)?.zoom ?? null;
}

/**
 * What the player shows (FR-76): the zoom of the effect under the playhead, except while paused inside
 * the selected effect with zoom on, where the whole frame shows with the rectangle to edit (`editing`).
 */
export function previewZoom(s: {
  cuts: readonly Cut[]; time: number; playing: boolean; selectedId: string | null; selectedEffectId: string | null;
}): { zoom: Zoom | null; editing: { cutId: string; effect: Effect } | null } {
  const cut = s.cuts.find((c) => c.id === s.selectedId);
  const effect = cut?.effects?.find((e) => e.id === s.selectedEffectId);
  if (cut && effect?.zoom && !s.playing && s.time >= effect.startSec && s.time < effect.endSec) {
    return { zoom: null, editing: { cutId: cut.id, effect } };
  }
  return { zoom: zoomAt(s.cuts, s.time, s.selectedId), editing: null };
}
