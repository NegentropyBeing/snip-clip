import { MAX_SPEED, MIN_SPEED, trimEffects } from "./effects";
import { clampZoom } from "./zoom";
import { PRESETS } from "./presets";
import type { Cut, CutOverride, Effect, OutputMode, PresetId, TrackMix, Zoom } from "./types";

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

/** An effect's zoom (FR-72), clamped to 1×–4× and inside the frame; undefined when malformed. */
function parseZoom(raw: unknown): Zoom | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { x, y, level } = raw as Record<string, unknown>;
  return isNum(x) && isNum(y) && isNum(level) ? clampZoom({ x, y, level }) : undefined;
}

/** A cut's well-formed effects (FR-61); trimEffects() then fits them to the cut. Unknown fields are dropped. */
function parseEffects(raw: unknown): Effect[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.flatMap((e): Effect[] => {
    if (typeof e !== "object" || e === null) return [];
    const { id, startSec, endSec, speed, zoom } = e as Record<string, unknown>;
    const ok = typeof id === "string" && isNum(startSec) && isNum(endSec) && isNum(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED;
    if (!ok) return [];
    const z = parseZoom(zoom);
    return [z ? { id, startSec, endSec, speed, zoom: z } : { id, startSec, endSec, speed }];
  });
  return out.length > 0 ? out : undefined;
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
    .map(({ id, name, startSec, endSec, override, effects }): Cut => {
      const kept = parseOverride(override, trackCount);
      const fx = parseEffects(effects);
      return trimEffects({ id, name, startSec, endSec, ...(kept ? { override: kept } : {}), ...(fx ? { effects: fx } : {}) });
    });
  const savedMix = Array.isArray(p.mix) ? p.mix : [];
  const mix = Array.from({ length: trackCount }, (_, i): TrackMix => parseTrackMix(savedMix[i]) ?? { enabled: true, volume: 1 });
  const presetId = typeof p.presetId === "string" && p.presetId in PRESETS ? (p.presetId as PresetId) : "discord-20";
  const mode: OutputMode = p.mode === "montage" ? "montage" : "separate";
  return { cuts, mix, presetId, mode, keepSeparateTracks: p.keepSeparateTracks === true };
}
