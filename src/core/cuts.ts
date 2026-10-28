import type { Cut } from "./types";

/** Shortest cut the editor accepts; also the gap kept between a dragged edge and the other one. */
export const MIN_CUT_SEC = 0.1;

/** Orders the edges and keeps the cut inside [0, duration] with at least MIN_CUT_SEC. */
export function normalizeCut(cut: Cut, durationSec: number): Cut {
  let start = Math.min(cut.startSec, cut.endSec);
  let end = Math.max(cut.startSec, cut.endSec);
  start = Math.min(Math.max(0, start), Math.max(0, durationSec - MIN_CUT_SEC));
  end = Math.min(Math.max(end, start + MIN_CUT_SEC), durationSec);
  return { ...cut, startSec: start, endSec: end };
}

/** Moves a cut without changing its length, stopping at the ends of the video. */
export function shiftCut(cut: Cut, deltaSec: number, durationSec: number): Cut {
  const len = cut.endSec - cut.startSec;
  const start = Math.min(Math.max(0, cut.startSec + deltaSec), Math.max(0, durationSec - len));
  return { ...cut, startSec: start, endSec: start + len };
}

/** Sets one edge, clamped so the cut never inverts or leaves the video. */
export function setEdge(cut: Cut, edge: "start" | "end", sec: number, durationSec: number): Cut {
  if (edge === "start") {
    return { ...cut, startSec: Math.min(Math.max(0, sec), cut.endSec - MIN_CUT_SEC) };
  }
  return { ...cut, endSec: Math.max(Math.min(durationSec, sec), cut.startSec + MIN_CUT_SEC) };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

export function totalDuration(cuts: readonly Cut[]): number {
  return cuts.reduce((acc, c) => acc + (c.endSec - c.startSec), 0);
}
