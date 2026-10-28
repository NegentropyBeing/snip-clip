import { cutMix } from "./cutOverride";
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

function videoFilters(req: ExportRequest): string {
  const { plan, media, preset, backend } = req;
  const f: string[] = [];
  if (plan.tonemap) f.push(TONEMAP);
  if (plan.height < media.height) f.push(`scale=-2:${plan.height}:flags=lanczos`);
  if (plan.fps < media.fps - 0.01) f.push(`fps=${plan.fps}`);
  const tenBit = preset.sizeLimitBytes === null;
  f.push(`format=${tenBit ? (backend === "cpu" ? "yuv420p10le" : "p010le") : "yuv420p"}`);
  return f.join(",");
}

interface Graph {
  filter: string;
  videoOut: string;
  audioOuts: string[];
}

function buildGraph(req: ExportRequest, includeAudio: boolean): Graph {
  const tracks = includeAudio ? enabledTracks(req) : [];
  const mixed = !(req.keepSeparateTracks && req.preset.sizeLimitBytes === null);
  const vf = videoFilters(req);
  const parts: string[] = [];
  // Per cut: one video label and the audio labels for that segment.
  const segments = req.cuts.map((cut, k) => {
    parts.push(`[${k}:v:0]${vf}[v${k}]`);
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
