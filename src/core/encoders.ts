import type { EncoderBackend, EncoderPreference, VideoCodec } from "./types";

/** FFmpeg encoder names per codec and backend. */
export const ENCODER_NAMES: Record<VideoCodec, Record<EncoderBackend, string>> = {
  h264: { cpu: "libx264", nvenc: "h264_nvenc", amf: "h264_amf", qsv: "h264_qsv" },
  av1: { cpu: "libsvtav1", nvenc: "av1_nvenc", amf: "av1_amf", qsv: "av1_qsv" },
};

const GPU_ORDER: EncoderBackend[] = ["nvenc", "amf", "qsv"];

/**
 * Chooses a backend from the encoders that passed the startup probe.
 * Size-limited H.264 defaults to CPU two-pass for size accuracy (spec FR-27).
 */
export function pickBackend(
  codec: VideoCodec,
  available: ReadonlySet<string>,
  preference: EncoderPreference,
  sizeLimited: boolean,
): EncoderBackend {
  const has = (b: EncoderBackend) => available.has(ENCODER_NAMES[codec][b]);
  const gpu = GPU_ORDER.find(has);
  if (preference === "cpu" || (preference === "auto" && sizeLimited && codec === "h264")) {
    if (has("cpu")) return "cpu";
  }
  if (gpu) return gpu;
  if (has("cpu")) return "cpu";
  throw new Error(`no ${codec} encoder available`);
}
