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

/** The tracks where a cut differs from the video's mix, by track ordinal (spec §17). */
export type CutOverride = Record<number, TrackMix>;

/** An enlarged region of the frame (spec §19): fixed for the whole effect. */
export interface Zoom {
  /** Centre of the region as a fraction of the frame's width and height (0..1). */
  x: number;
  y: number;
  /** 1..4: the region is 1/level of the frame in each direction (FR-72). */
  level: number;
}

/** A part of a cut that plays at another speed, zoomed in, or both (spec §18, §19). */
export interface Effect {
  id: string;
  /** Source-video time, inside the cut: the effect stays at this moment of the video (FR-60). */
  startSec: number;
  endSec: number;
  /** Playback speed: 0.5 = half speed, 1 for zoom-only effects (FR-59, FR-73). */
  speed: number;
  /** Absent: the whole frame is shown. */
  zoom?: Zoom;
}

export interface Cut {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
  /** Absent: every track follows the video's mix. */
  override?: CutOverride;
  /** In time order, inside the cut, never overlapping; absent: the cut plays at normal speed. */
  effects?: Effect[];
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
