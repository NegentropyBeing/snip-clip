import { cutMix } from "./cutOverride";
import { cutPieces, hasEffects, type Piece } from "./effects";
import { cropRect } from "./zoom";
import { ENCODER_NAMES } from "./encoders";
import type { Cut, EncoderBackend, MediaInfo, OutputPlan, Preset, TrackMix, VideoCodec } from "./types";

export interface ExportRequest {
  media: MediaInfo;
  /** Indexed by audio track ordinal. */
  mix: TrackMix[];
  /** One cut for a separate export; several for a montage, in output order. */
  cuts: Cut[];
  preset: Preset;
  /** Only meaningful for unlimited presets: keep each enabled track as its own stream. */
  keepSeparateTracks?: boolean;
  backend: EncoderBackend;
  plan: OutputPlan;
  outPath: string;
  /** Prefix for x264 two-pass log files. */
  passLogPrefix: string;
}

export interface FfmpegJob {
  /** Each entry is one FFmpeg invocation (argv without the binary), run in order. */
  passes: string[][];
}

const GLOBAL_ARGS = ["-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1"];
const UNLIMITED_CQ = 28;
// HDR (PQ/HLG) -> SDR BT.709; needs an FFmpeg build with zimg.
export const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

const sec = (s: number) => s.toFixed(3);

/** Tracks on in at least one cut: they go in the file, silent in the cuts where they are off (FR-55). */
function enabledTracks(req: ExportRequest): number[] {
  const mixes = req.cuts.map((c) => cutMix(req.mix, c));
  return req.media.audioTracks.map((t) => t.index).filter((i) => mixes.some((m) => m[i]?.enabled));
}

function inputArgs(req: ExportRequest): string[] {
  // One input per cut, seeked on the input side: fast, and frame-accurate when re-encoding.
  return req.cuts.flatMap((c) => ["-ss", sec(c.startSec), "-t", sec(c.endSec - c.startSec), "-i", req.media.path]);
}

const hasZoom = (cut: Cut) => cut.effects?.some((e) => e.zoom) ?? false;

/** `retimed`: the cut has effects, so `fps` repeats the slowed frames back to a constant rate (FR-68). */
function videoFilters(req: ExportRequest, retimed = false): string {
  const { plan, media, preset, backend } = req;
  const f: string[] = [];
  if (plan.tonemap) f.push(TONEMAP);
  if (plan.height < media.height) f.push(`scale=-2:${plan.height}:flags=lanczos`);
  if (retimed || plan.fps < media.fps - 0.01) f.push(`fps=${plan.fps}`);
  const tenBit = preset.sizeLimitBytes === null;
  f.push(`format=${tenBit ? (backend === "cpu" ? "yuv420p10le" : "p010le") : "yuv420p"}`);
  // Zoomed pieces are rescaled, which can change the pixel shape; concat needs it equal in every cut.
  if (req.cuts.some(hasZoom)) f.push("setsar=1");
  return f.join(",");
}

interface Graph {
  filter: string;
  videoOut: string;
  audioOuts: string[];
}

const num = (n: number) => String(Number(n.toFixed(6)));

/** atempo keeps the pitch; older FFmpeg builds take 0.5..2 per instance, so slower speeds chain it. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  for (; s < 0.5 - 1e-9; s /= 0.5) out.push("atempo=0.5");
  for (; s > 2 + 1e-9; s /= 2) out.push("atempo=2");
  if (Math.abs(s - 1) > 1e-9) out.push(`atempo=${num(s)}`);
  return out;
}

/**
 * Plays a cut with effects (FR-68, FR-77): the cut is split where the speed or zoom changes, each piece
 * is slowed (video by stretching timestamps, audio with atempo) and zoomed, and the pieces are joined
 * back in order.
 */
function retime(req: ExportRequest, cut: Cut, k: number, audioIn: string[], parts: string[]): { video: string; audio: string[] } {
  const pieces = cutPieces(cut);
  const n = pieces.length;
  const vf = videoFilters(req, true);
  // Input-side seeking puts the cut start at 0; the first and last pieces stay open-ended.
  const range = (p: Piece, i: number) =>
    [i > 0 ? `start=${sec(p.startSec - cut.startSec)}` : "", i < n - 1 ? `end=${sec(p.endSec - cut.startSec)}` : ""].filter(Boolean).join(":");
  // A zoomed piece is cropped to its region and scaled back to the frame size, so the pieces can be
  // joined and the usual filters (tone mapping, resolution ladder) apply to the whole cut (FR-77).
  const zoomed = hasZoom(cut);
  const { width, height } = req.media;
  const zoomChain = (p: Piece) => {
    if (!p.zoom) return [];
    const r = cropRect(p.zoom, width, height);
    return [`crop=${r.w}:${r.h}:${r.x}:${r.y}`, `scale=${width}:${height}:flags=lanczos`];
  };
  const videoChain = (p: Piece, i: number) =>
    [
      n > 1 ? `trim=${range(p, i)}` : null,
      p.speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${num(p.speed)}`,
      ...zoomChain(p),
      zoomed ? "setsar=1" : null,
    ].filter(Boolean).join(",");
  const audioChain = (p: Piece, i: number) =>
    [n > 1 ? `atrim=${range(p, i)}` : null, "asetpts=PTS-STARTPTS", ...atempoChain(p.speed)].filter(Boolean).join(",");

  if (n === 1) {
    parts.push(`[${k}:v:0]${videoChain(pieces[0], 0)},${vf}[v${k}]`);
    const audio = audioIn.map((l) => {
      parts.push(`[${l}]${audioChain(pieces[0], 0)}[${l}t]`);
      return `${l}t`;
    });
    return { video: `v${k}`, audio };
  }
  const labels = (prefix: string) => pieces.map((_, i) => `${prefix}${i}`);
  const list = (ls: string[]) => ls.map((l) => `[${l}]`).join("");
  const splitV = labels(`s${k}_`);
  parts.push(`[${k}:v:0]split=${n}${list(splitV)}`);
  const videoPieces = pieces.map((p, i) => {
    parts.push(`[${splitV[i]}]${videoChain(p, i)}[p${k}_${i}]`);
    return `p${k}_${i}`;
  });
  const audioPieces = audioIn.map((l) => {
    const splitA = labels(`${l}s`);
    parts.push(`[${l}]asplit=${n}${list(splitA)}`);
    return pieces.map((p, i) => {
      parts.push(`[${splitA[i]}]${audioChain(p, i)}[${l}p${i}]`);
      return `${l}p${i}`;
    });
  });
  const inputs = pieces.map((_, i) => list([videoPieces[i], ...audioPieces.map((a) => a[i])])).join("");
  const audio = audioIn.map((_, j) => `ca${k}_${j}`);
  parts.push(`${inputs}concat=n=${n}:v=1:a=${audioIn.length}[c${k}]${list(audio)}`);
  parts.push(`[c${k}]${vf}[v${k}]`);
  return { video: `v${k}`, audio };
}

function buildGraph(req: ExportRequest, includeAudio: boolean): Graph {
  const tracks = includeAudio ? enabledTracks(req) : [];
  const mixed = !(req.keepSeparateTracks && req.preset.sizeLimitBytes === null);
  const vf = videoFilters(req);
  const parts: string[] = [];
  // Per cut: one video label and the audio labels for that segment.
  const segments = req.cuts.map((cut, k) => {
    const audio: string[] = [];
    const mix = cutMix(req.mix, cut);
    if (tracks.length > 0) {
      const gained = tracks.map((t) => {
        const label = `a${k}_${t}`;
        const gain = mix[t].enabled ? mix[t].volume : 0;
        parts.push(`[${k}:a:${t}]volume=${gain.toFixed(2)}[${label}]`);
        return label;
      });
      if (!mixed) audio.push(...gained);
      else if (gained.length === 1) audio.push(gained[0]);
      else {
        parts.push(`${gained.map((g) => `[${g}]`).join("")}amix=inputs=${gained.length}:normalize=0:duration=longest[a${k}]`);
        audio.push(`a${k}`);
      }
    }
    // The mix and the cut override apply inside effects like in the rest of the cut.
    if (hasEffects(cut)) return retime(req, cut, k, audio, parts);
    parts.push(`[${k}:v:0]${vf}[v${k}]`);
    return { video: `v${k}`, audio };
  });

  if (segments.length === 1) {
    return { filter: parts.join(";"), videoOut: segments[0].video, audioOuts: segments[0].audio };
  }
  const audioCount = segments[0].audio.length;
  const inputs = segments.map((s) => [s.video, ...s.audio].map((l) => `[${l}]`).join("")).join("");
  const audioOuts = Array.from({ length: audioCount }, (_, i) => `aout${i}`);
  parts.push(`${inputs}concat=n=${segments.length}:v=1:a=${audioCount}[vout]${audioOuts.map((l) => `[${l}]`).join("")}`);
  return { filter: parts.join(";"), videoOut: "vout", audioOuts };
}

function videoEncoderArgs(codec: VideoCodec, backend: EncoderBackend, plan: OutputPlan): string[] {
  const name = ENCODER_NAMES[codec][backend];
  if (plan.videoKbps === null) {
    // Constant quality (unlimited presets).
    switch (backend) {
      case "cpu": return ["-c:v", name, "-preset", "6", "-crf", "30"];
      case "nvenc": return ["-c:v", name, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(UNLIMITED_CQ), "-b:v", "0", "-multipass", "qres"];
      case "amf": return ["-c:v", name, "-rc", "qvbr", "-qvbr_quality_level", String(UNLIMITED_CQ)];
      case "qsv": return ["-c:v", name, "-global_quality", String(UNLIMITED_CQ)];
    }
  }
  const kbps = plan.videoKbps;
  const rate = ["-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`];
  switch (backend) {
    case "cpu":
      return codec === "h264" ? ["-c:v", name, "-preset", "slow", "-b:v", `${kbps}k`] : ["-c:v", name, "-preset", "6", "-b:v", `${kbps}k`];
    case "nvenc": return ["-c:v", name, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-multipass", "fullres", ...rate];
    case "amf": return ["-c:v", name, "-rc", "vbr_peak", ...rate];
    case "qsv": return ["-c:v", name, ...rate];
  }
}

function copyJob(req: ExportRequest): FfmpegJob {
  if (req.cuts.length !== 1) throw new Error("stream copy exports one cut per file");
  const audioMaps = enabledTracks(req).flatMap((t) => ["-map", `0:a:${t}`]);
  return {
    passes: [[
      ...GLOBAL_ARGS, ...inputArgs(req),
      "-map", "0:v:0", ...audioMaps,
      "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", req.outPath,
    ]],
  };
}

export function buildJob(req: ExportRequest): FfmpegJob {
  if (req.cuts.length === 0) throw new Error("no cuts to export");
  const { preset, backend, plan } = req;
  if (preset.codec === "copy") return copyJob(req);

  const codec = preset.codec;
  const video = videoEncoderArgs(codec, backend, plan);
  const color = plan.tonemap ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : [];
  const graph = buildGraph(req, true);
  const audio = graph.audioOuts.length > 0 ? ["-c:a", "aac", "-b:a", `${plan.audioKbps}k`, "-ac", "2"] : ["-an"];
  const maps = ["-map", `[${graph.videoOut}]`, ...graph.audioOuts.flatMap((l) => ["-map", `[${l}]`])];
  const finalArgs = [...video, ...color, ...audio, "-movflags", "+faststart", req.outPath];

  const twoPass = backend === "cpu" && codec === "h264" && plan.videoKbps !== null;
  if (!twoPass) {
    return { passes: [[...GLOBAL_ARGS, ...inputArgs(req), "-filter_complex", graph.filter, ...maps, ...finalArgs]] };
  }
  // Pass 1 analyses video only; unused audio labels would make FFmpeg fail.
  const g1 = buildGraph(req, false);
  const pass = (n: 1 | 2) => ["-pass", String(n), "-passlogfile", req.passLogPrefix];
  return {
    passes: [
      [...GLOBAL_ARGS, ...inputArgs(req), "-filter_complex", g1.filter, "-map", `[${g1.videoOut}]`, ...video, ...pass(1), "-an", "-f", "null", "-"],
      [...GLOBAL_ARGS, ...inputArgs(req), "-filter_complex", graph.filter, ...maps, ...video, ...pass(2), ...color, ...audio, "-movflags", "+faststart", req.outPath],
    ],
  };
}
