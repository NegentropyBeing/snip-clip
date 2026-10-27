import type { MediaInfo, OutputPlan, Preset, VideoCodec } from "./types";

/** Fraction of the size limit we aim for, leaving room for encoder variance. */
export const TARGET_FRACTION = 0.975;
/** Estimated MP4 container overhead as a fraction of the total bitrate. */
const MUX_OVERHEAD = 0.015;
const AUDIO_KBPS = 128;
const AUDIO_KBPS_LOW = 96;
/** Below this video budget, audio drops to AUDIO_KBPS_LOW. */
const LOW_AUDIO_THRESHOLD_KBPS = 2500;
export const LOW_QUALITY_KBPS = 1000;
export const MAX_FPS_LIMITED = 60;

interface Rung {
  height: number;
  fps: number;
  minKbps: Record<VideoCodec, number>;
}

/** Highest rung whose minimum bitrate fits the budget wins; the last rung is the floor. */
const LADDER: Rung[] = [
  { height: 1440, fps: 60, minKbps: { h264: 9000, av1: 5500 } },
  { height: 1080, fps: 60, minKbps: { h264: 5000, av1: 3000 } },
  { height: 1080, fps: 30, minKbps: { h264: 3000, av1: 1800 } },
  { height: 720, fps: 30, minKbps: { h264: 0, av1: 0 } },
];

export function targetBytes(limitBytes: number): number {
  return Math.floor(limitBytes * TARGET_FRACTION);
}

export function splitBudget(durationSec: number, limitBytes: number): { videoKbps: number; audioKbps: number } {
  if (durationSec <= 0) throw new Error("duration must be positive");
  const totalKbps = (targetBytes(limitBytes) * 8) / 1000 / durationSec;
  const available = totalKbps * (1 - MUX_OVERHEAD);
  const audioKbps = available - AUDIO_KBPS < LOW_AUDIO_THRESHOLD_KBPS ? AUDIO_KBPS_LOW : AUDIO_KBPS;
  return { videoKbps: Math.max(1, Math.floor(available - audioKbps)), audioKbps };
}

/** Picks output height/fps for a size-limited export. Never upscales or raises fps. */
export function chooseRung(videoKbps: number, codec: VideoCodec, source: Pick<MediaInfo, "height" | "fps">): { height: number; fps: number } {
  const sourceFps = Math.min(source.fps, MAX_FPS_LIMITED);
  const candidates = LADDER.filter((r) => r.height <= source.height);
  if (candidates.length === 0) return { height: source.height, fps: Math.min(sourceFps, 30) };
  const rung = candidates.find((r) => videoKbps >= r.minKbps[codec]) ?? candidates[candidates.length - 1];
  return { height: rung.height, fps: Math.min(rung.fps, sourceFps) };
}

export function planOutput(preset: Preset, media: Pick<MediaInfo, "height" | "fps" | "hdr">, durationSec: number): OutputPlan {
  if (preset.sizeLimitBytes === null || preset.codec === "copy") {
    return {
      height: media.height,
      fps: media.fps,
      videoKbps: null,
      audioKbps: AUDIO_KBPS,
      lowQuality: false,
      tonemap: false,
    };
  }
  const { videoKbps, audioKbps } = splitBudget(durationSec, preset.sizeLimitBytes);
  const { height, fps } = chooseRung(videoKbps, preset.codec, media);
  return { height, fps, videoKbps, audioKbps, lowQuality: videoKbps < LOW_QUALITY_KBPS, tonemap: media.hdr };
}

/** Video bitrate for a re-encode after the output overshot the limit. */
export function retryKbps(videoKbps: number, actualBytes: number, limitBytes: number): number {
  const factor = (targetBytes(limitBytes) * 0.98) / actualBytes;
  return Math.max(1, Math.floor(videoKbps * Math.min(factor, 0.97)));
}
