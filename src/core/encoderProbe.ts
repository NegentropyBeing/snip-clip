import { ENCODER_NAMES } from "./encoders";

/** Result of running a short FFmpeg command (the Tauri `exec_tool` command, or Node in tests). */
export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Exec = (args: string[]) => Promise<ExecResult>;

const CANDIDATES = Object.values(ENCODER_NAMES).flatMap((byBackend) => Object.values(byBackend));
const CPU_ENCODERS = new Set([ENCODER_NAMES.h264.cpu, ENCODER_NAMES.av1.cpu]);

/** Encoder names from `ffmpeg -encoders` output (" V....D libx264  description"). */
export function parseEncoderList(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*V\S{5}\s+(\S+)/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * A tiny encode that fails fast when the GPU/driver behind an encoder is missing.
 * VAAPI encoders need a render node (e.g. /dev/dri/renderD128) and frames uploaded to it.
 */
export function testEncodeArgs(encoder: string, vaapiDevice?: string): string[] {
  const vaapi = encoder.endsWith("_vaapi");
  return [
    "-hide_banner", "-v", "error",
    ...(vaapi && vaapiDevice ? ["-vaapi_device", vaapiDevice] : []),
    "-f", "lavfi", "-i", "color=black:s=320x240:r=30:d=0.2",
    "-frames:v", "3", ...(vaapi ? ["-vf", "format=nv12,hwupload"] : ["-pix_fmt", "yuv420p"]),
    "-c:v", encoder, "-f", "null", "-",
  ];
}

/**
 * Encoders that can actually run on this machine (spec FR-26). Built-in CPU encoders are trusted
 * once listed; hardware encoders are listed by most builds even without the hardware, so each
 * one gets a test encode. `candidates` defaults to the export encoders; the replay profile
 * passes its own (spec FR-41).
 */
export async function detectEncoders(exec: Exec, candidates: readonly string[] = CANDIDATES, vaapiDevice?: string): Promise<Set<string>> {
  const listed = parseEncoderList((await exec(["-hide_banner", "-encoders"])).stdout);
  const usable = new Set<string>();
  for (const name of candidates) {
    if (!listed.has(name)) continue;
    if (CPU_ENCODERS.has(name) || (await exec(testEncodeArgs(name, vaapiDevice))).code === 0) usable.add(name);
  }
  return usable;
}
