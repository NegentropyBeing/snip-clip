import { TONEMAP } from "./ffmpeg";
import type { MediaInfo, TrackMix } from "./types";

/** Samples per second of the loudness envelope used for waveforms. */
export const ENVELOPE_RATE = 1000;
export const PROXY_HEIGHT = 540;

export interface PreviewFiles {
  /** Per audio track, indexed by track ordinal. */
  audio: string[];
  envelope: string[];
}

export function previewFiles(dir: string, trackCount: number, sep = "/"): PreviewFiles {
  const range = Array.from({ length: trackCount }, (_, i) => i);
  return {
    audio: range.map((i) => `${dir}${sep}track${i}.m4a`),
    envelope: range.map((i) => `${dir}${sep}track${i}.env`),
  };
}

/**
 * One FFmpeg run that writes, for every audio track, a light AAC file for live playback
 * and a mono loudness envelope (|sample| low-passed to ENVELOPE_RATE, raw s16le) for the waveform.
 */
export function previewAudioArgs(media: MediaInfo, files: PreviewFiles): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1", "-i", media.path, "-vn", "-sn", "-dn"];
  for (const t of media.audioTracks) {
    args.push("-map", `0:a:${t.index}`, "-c:a", "aac", "-b:a", "96k", "-ac", "2", files.audio[t.index]);
    args.push(
      "-map", `0:a:${t.index}`,
      "-af", `aformat=channel_layouts=mono,aeval=abs(val(0)),aresample=${ENVELOPE_RATE}`,
      "-c:a", "pcm_s16le", "-f", "s16le", files.envelope[t.index],
    );
  }
  return args;
}

/** H.264 540p, short GOP for snappy seeking. Used when the WebView cannot decode the source. */
export function proxyArgs(media: MediaInfo, outPath: string): string[] {
  const vf = [media.hdr ? TONEMAP : null, media.height > PROXY_HEIGHT ? `scale=-2:${PROXY_HEIGHT}` : null, "format=yuv420p"]
    .filter(Boolean)
    .join(",");
  return [
    "-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1",
    "-i", media.path, "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "30",
    "-movflags", "+faststart", outPath,
  ];
}

/** Raw s16le bytes -> envelope in 0..1. */
export function decodeEnvelope(bytes: ArrayBuffer): Float32Array {
  const pcm = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2));
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.abs(pcm[i]) / 32768;
  return out;
}

/** Approximate envelope of the current mix: gain-weighted sum of the enabled tracks, clipped to 1. */
export function mixEnvelope(tracks: readonly (Float32Array | undefined)[], mix: readonly TrackMix[]): Float32Array {
  const length = Math.max(0, ...tracks.map((t) => t?.length ?? 0));
  const out = new Float32Array(length);
  tracks.forEach((env, i) => {
    const m = mix[i];
    if (!env || !m?.enabled || m.volume === 0) return;
    for (let j = 0; j < env.length; j++) out[j] += env[j] * m.volume;
  });
  for (let j = 0; j < length; j++) if (out[j] > 1) out[j] = 1;
  return out;
}

/** Height of each per-track waveform lane: they share `minTotal`, but never get thinner than 22 px. */
export function laneHeight(tracks: number, minTotal: number): number {
  return Math.max(22, Math.floor(minTotal / Math.max(1, tracks)));
}

/** Peak per output column over [fromSec, toSec). */
export function envelopeColumns(env: Float32Array, fromSec: number, toSec: number, columns: number): Float32Array {
  const out = new Float32Array(columns);
  const perCol = ((toSec - fromSec) * ENVELOPE_RATE) / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.max(0, Math.floor(fromSec * ENVELOPE_RATE + c * perCol));
    const b = Math.min(env.length, Math.max(a + 1, Math.floor(fromSec * ENVELOPE_RATE + (c + 1) * perCol)));
    let peak = 0;
    for (let j = a; j < b; j++) if (env[j] > peak) peak = env[j];
    out[c] = peak;
  }
  return out;
}
