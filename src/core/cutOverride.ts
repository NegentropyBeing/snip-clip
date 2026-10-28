// Cut overrides (spec §17): a cut keeps only the tracks where it differs from the video's mix;
// every other track follows the mix, including later changes to it.
import type { Cut, CutOverride, TrackMix } from "./types";

const FULL: TrackMix = { enabled: true, volume: 1 };

/** The mix inside a cut: the video's mix with the cut's override on top (FR-47). */
export function cutMix(mix: readonly TrackMix[], cut: Cut | null | undefined): TrackMix[] {
  const override = cut?.override;
  return mix.map((m, i) => override?.[i] ?? m);
}

export function hasOverride(cut: Cut): boolean {
  return cut.override !== undefined && Object.keys(cut.override).length > 0;
}

/** Changes one track of a cut, starting from what the cut plays now (FR-50). */
export function overrideTrack(cut: Cut, mix: readonly TrackMix[], index: number, patch: Partial<TrackMix>): Cut {
  const current = cut.override?.[index] ?? mix[index] ?? FULL;
  return { ...cut, override: { ...cut.override, [index]: { ...current, ...patch } } };
}

/** The track follows the video's mix again; without an index, every track does (FR-50, FR-51). */
export function clearOverride(cut: Cut, index?: number): Cut {
  const { override, ...rest } = cut;
  if (index === undefined || !override) return rest;
  const kept: CutOverride = { ...override };
  delete kept[index];
  return Object.keys(kept).length > 0 ? { ...rest, override: kept } : rest;
}

/**
 * The cut whose mix plays at `sec` (FR-52): the selected cut if it covers `sec`, otherwise the one
 * that starts first; null outside every cut.
 */
export function cutAt(cuts: readonly Cut[], sec: number, selectedId: string | null): Cut | null {
  let first: Cut | null = null;
  for (const c of cuts) {
    if (sec < c.startSec || sec >= c.endSec) continue;
    if (c.id === selectedId) return c;
    if (!first || c.startSec < first.startSec) first = c;
  }
  return first;
}

export interface MixRegion {
  startSec: number;
  endSec: number;
  mix: TrackMix[];
}

/**
 * The timeline split where the playing mix changes, covering [0, durationSec), for the waveform
 * (FR-53). Adjacent pieces with the same playing cut are joined.
 */
export function mixRegions(mix: readonly TrackMix[], cuts: readonly Cut[], selectedId: string | null, durationSec: number): MixRegion[] {
  const edges = [...new Set([0, durationSec, ...cuts.flatMap((c) => [c.startSec, c.endSec])])]
    .filter((s) => s >= 0 && s <= durationSec)
    .sort((a, b) => a - b);
  const regions: (MixRegion & { cut: Cut | null })[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [startSec, endSec] = [edges[i], edges[i + 1]];
    const cut = cutAt(cuts, (startSec + endSec) / 2, selectedId);
    const last = regions.at(-1);
    if (last && last.cut === cut) last.endSec = endSec;
    else regions.push({ startSec, endSec, cut, mix: cutMix(mix, cut) });
  }
  return regions.map(({ startSec, endSec, mix: m }) => ({ startSec, endSec, mix: m }));
}
