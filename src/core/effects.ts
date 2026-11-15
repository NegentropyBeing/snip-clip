// Effects (spec §18): parts of a cut that play at another speed. They are anchored to the moment of
// the video, so trimming the cut trims them, and they are kept in time order without overlaps.
import { cutAt } from "./cutOverride";
import type { Cut, Effect, Zoom } from "./types";

/** Shortest effect; also the gap a dragged edge keeps from the other one (FR-58). */
export const MIN_EFFECT_SEC = 0.2;
/** Length and speed of a new effect (FR-62). */
export const NEW_EFFECT_SEC = 2;
export const DEFAULT_SPEED = 0.5;
/** Speeds offered in the effect panel; 1× is for zoom-only effects (FR-59, FR-73). */
export const EFFECT_SPEEDS = [1, 0.5, 0.25];
/** Speeds a saved project may hold: room for speed-up later without a migration (FR-59). */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4;

// Float slack so an effect trimmed to exactly the minimum survives.
const EPS = 1e-9;

export function hasEffects(cut: Cut): boolean {
  return cut.effects !== undefined && cut.effects.length > 0;
}

function withEffects(cut: Cut, effects: Effect[]): Cut {
  const { effects: _, ...rest } = cut;
  return effects.length > 0 ? { ...rest, effects } : rest;
}

/**
 * Keeps the effects valid for the cut's current edges (FR-60): sorted, clipped to the cut and to the
 * previous effect, and removed under the minimum length.
 */
export function trimEffects(cut: Cut): Cut {
  if (!cut.effects) return cut;
  const kept: Effect[] = [];
  for (const e of [...cut.effects].sort((a, b) => a.startSec - b.startSec)) {
    const startSec = Math.max(e.startSec, cut.startSec, kept.at(-1)?.endSec ?? -Infinity);
    const endSec = Math.min(e.endSec, cut.endSec);
    if (endSec - startSec >= MIN_EFFECT_SEC - EPS) kept.push(startSec === e.startSec && endSec === e.endSec ? e : { ...e, startSec, endSec });
  }
  return withEffects(cut, kept);
}

/** The effect playing at `sec` inside the cut, or null. */
export function effectAt(cut: Cut | null | undefined, sec: number): Effect | null {
  return cut?.effects?.find((e) => sec >= e.startSec && sec < e.endSec) ?? null;
}

/**
 * Where a new effect at `sec` would go (FR-62): NEW_EFFECT_SEC long, shortened to the free space before
 * the end of the cut or the next effect; null outside the cut, inside an effect or without the minimum.
 */
export function effectSlot(cut: Cut, sec: number): { startSec: number; endSec: number } | null {
  if (sec < cut.startSec || sec >= cut.endSec || effectAt(cut, sec)) return null;
  const next = cut.effects?.find((e) => e.startSec > sec);
  const endSec = Math.min(sec + NEW_EFFECT_SEC, cut.endSec, next?.startSec ?? Infinity);
  return endSec - sec >= MIN_EFFECT_SEC - EPS ? { startSec: sec, endSec } : null;
}

export function addEffect(cut: Cut, sec: number, id: string): Cut | null {
  const slot = effectSlot(cut, sec);
  if (!slot) return null;
  const effects = [...(cut.effects ?? []), { id, ...slot, speed: DEFAULT_SPEED }].sort((a, b) => a.startSec - b.startSec);
  return { ...cut, effects };
}

/** Sets one edge, stopping at the cut edges and the neighbouring effects (FR-63). */
export function setEffectEdge(cut: Cut, id: string, edge: "start" | "end", sec: number): Cut {
  const effects = cut.effects ?? [];
  const i = effects.findIndex((e) => e.id === id);
  if (i < 0) return cut;
  const e = effects[i];
  const next = edge === "start"
    ? { ...e, startSec: Math.min(Math.max(sec, effects[i - 1]?.endSec ?? cut.startSec), e.endSec - MIN_EFFECT_SEC) }
    : { ...e, endSec: Math.max(Math.min(sec, effects[i + 1]?.startSec ?? cut.endSec), e.startSec + MIN_EFFECT_SEC) };
  return { ...cut, effects: effects.map((x) => (x.id === id ? next : x)) };
}

/** Moves the whole effect to start at `startSec`, keeping its length, between the cut edges and the neighbouring effects. */
export function moveEffect(cut: Cut, id: string, startSec: number): Cut {
  const effects = cut.effects ?? [];
  const i = effects.findIndex((e) => e.id === id);
  if (i < 0) return cut;
  const e = effects[i];
  const length = e.endSec - e.startSec;
  const min = effects[i - 1]?.endSec ?? cut.startSec;
  const max = (effects[i + 1]?.startSec ?? cut.endSec) - length;
  const start = Math.max(min, Math.min(startSec, max));
  return { ...cut, effects: effects.map((x) => (x.id === id ? { ...e, startSec: start, endSec: start + length } : x)) };
}

export function setEffectSpeed(cut: Cut, id: string, speed: number): Cut {
  return cut.effects ? { ...cut, effects: cut.effects.map((e) => (e.id === id ? { ...e, speed } : e)) } : cut;
}

export function removeEffect(cut: Cut, id: string): Cut {
  return withEffects(cut, (cut.effects ?? []).filter((e) => e.id !== id));
}

/** "Remove effects" in the cut list (FR-65). */
export function clearEffects(cut: Cut): Cut {
  return withEffects(cut, []);
}

export interface Piece {
  startSec: number;
  endSec: number;
  speed: number;
  /** The effect's zoom; absent: the whole frame. */
  zoom?: Zoom;
}

/** The cut split where the speed or the zoom changes, covering it from start to end, in source-video time. */
export function cutPieces(cut: Cut): Piece[] {
  const pieces: Piece[] = [];
  let at = cut.startSec;
  for (const e of cut.effects ?? []) {
    if (e.startSec > at) pieces.push({ startSec: at, endSec: e.startSec, speed: 1 });
    pieces.push({ startSec: e.startSec, endSec: e.endSec, speed: e.speed, ...(e.zoom ? { zoom: e.zoom } : {}) });
    at = e.endSec;
  }
  if (cut.endSec > at) pieces.push({ startSec: at, endSec: cut.endSec, speed: 1 });
  return pieces;
}

/** How long the cut lasts in the exported file: each effect at its speed (FR-69). */
export function outputDuration(cut: Cut): number {
  return (cut.effects ?? []).reduce((acc, e) => acc + (e.endSec - e.startSec) * (1 / e.speed - 1), cut.endSec - cut.startSec);
}

export function totalOutputDuration(cuts: readonly Cut[]): number {
  return cuts.reduce((acc, c) => acc + outputDuration(c), 0);
}

/** Preview speed at `sec`: the effect's in the playing cut, by the rule of FR-52 (FR-67). */
export function speedAt(cuts: readonly Cut[], sec: number, selectedId: string | null): number {
  return effectAt(cutAt(cuts, sec, selectedId), sec)?.speed ?? 1;
}
