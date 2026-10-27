export interface AudioTrack {
  /** Ordinal among audio streams, as used by FFmpeg's `0:a:N`. */
  index: number;
  /** Stream title (OBS writes track names); null when the file has none. */
  title: string | null;
  channels: number;
  codec: string;
}

export interface MediaInfo {
  path: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hdr: boolean;
  audioTracks: AudioTrack[];
}

export interface TrackMix {
  enabled: boolean;
  /** Linear gain, 0..2 (0–200%). */
  volume: number;
}

export interface Cut {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
}

export type OutputMode = "separate" | "montage";

export type VideoCodec = "h264" | "av1";

export type EncoderBackend = "cpu" | "nvenc" | "amf" | "qsv";

export type EncoderPreference = "auto" | "gpu" | "cpu";

export type PresetId =
  | "discord-20"
  | "discord-20-av1"
  | "nitro-basic-50"
  | "nitro-500"
  | "unlimited"
  | "original";

export interface Preset {
  id: PresetId;
  /** Hard size limit in bytes; null = no limit. */
  sizeLimitBytes: number | null;
  /** "copy" = stream copy, no re-encode. */
  codec: VideoCodec | "copy";
  /** Mix enabled tracks into one (true) or keep each track as its own stream. */
  mixAudio: boolean;
  /** Supports joining all cuts into one file. */
  allowsMontage: boolean;
}

export interface OutputPlan {
  height: number;
  fps: number;
  videoKbps: number | null;
  audioKbps: number;
  /** Bitrate is too low for decent quality; UI should warn. */
  lowQuality: boolean;
  tonemap: boolean;
}
