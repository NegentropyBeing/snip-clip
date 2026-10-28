import { PRESETS } from "./presets";
import type { Cut, CutOverride, OutputMode, PresetId, TrackMix } from "./types";

/** What the editor auto-saves per video (spec FR-13). */
export interface ProjectFile {
  version: 1;
  path: string;
  cuts: Cut[];
  mix: TrackMix[];
  presetId: PresetId;
  mode: OutputMode;
  keepSeparateTracks: boolean;
}

/** Identity of a video file: path + size + modification time (FR-14), as a short stable hash. */
export function mediaKey(path: string, size: number, mtimeMs: number): string {
  // FNV-1a 64-bit over UTF-16 code units.
  let h = 0xcbf29ce484222325n;
  for (const ch of `${path}\u0000${size}\u0000${Math.round(mtimeMs)}`) {
    h ^= BigInt(ch.charCodeAt(0));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseTrackMix(m: unknown): TrackMix | null {
  if (typeof m !== "object" || m === null) return null;
  const { enabled, volume } = m as Record<string, unknown>;
  return typeof enabled === "boolean" && isNum(volume) ? { enabled, volume: Math.min(2, Math.max(0, volume)) } : null;
}

/** A cut override's valid tracks (FR-49); undefined when none is left. */
function parseOverride(raw: unknown, trackCount: number): CutOverride | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: CutOverride = {};
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    const m = parseTrackMix(value);
    if (Number.isInteger(index) && index >= 0 && index < trackCount && m) out[index] = m;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parses a saved project, dropping anything malformed instead of failing the whole file. */
export function parseProject(json: string, trackCount: number): Omit<ProjectFile, "version" | "path"> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || (raw as { version?: unknown }).version !== 1) return null;
  const p = raw as Record<string, unknown>;
  const cuts = (Array.isArray(p.cuts) ? p.cuts : [])
    .filter(
      (c): c is Cut =>
        typeof c === "object" && c !== null && typeof c.id === "string" && typeof c.name === "string"
        && isNum(c.startSec) && isNum(c.endSec) && c.endSec > c.startSec,
    )
    .map(({ id, name, startSec, endSec, override }): Cut => {
      const kept = parseOverride(override, trackCount);
      return kept ? { id, name, startSec, endSec, override: kept } : { id, name, startSec, endSec };
    });
  const savedMix = Array.isArray(p.mix) ? p.mix : [];
  const mix = Array.from({ length: trackCount }, (_, i): TrackMix => parseTrackMix(savedMix[i]) ?? { enabled: true, volume: 1 });
  const presetId = typeof p.presetId === "string" && p.presetId in PRESETS ? (p.presetId as PresetId) : "discord-20";
  const mode: OutputMode = p.mode === "montage" ? "montage" : "separate";
  return { cuts, mix, presetId, mode, keepSeparateTracks: p.keepSeparateTracks === true };
}
