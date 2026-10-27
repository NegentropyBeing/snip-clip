import type { AudioTrack, MediaInfo } from "./types";

/** ffprobe arguments whose JSON output `parseProbe` understands (path appended by the caller). */
export const PROBE_ARGS = [
  "-v", "error",
  "-show_entries",
  "format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,color_transfer,channels:stream_tags=title,handler_name",
  "-of", "json",
];

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_transfer?: string;
  channels?: number;
  tags?: { title?: string; handler_name?: string };
}

interface ProbeJson {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

/** Handler names muxers write by default; they say nothing about the track's content. */
const GENERIC_HANDLER = /^(sound|audio)\s*(media\s*)?handle(r)?$|^core media audio$|^gpac iso audio handler$|^l-smash audio handler$|^mainconcept mp4 sound media handler$/i;

function rate(value: string | undefined): number {
  const [num, den] = (value ?? "").split("/").map(Number);
  return num > 0 && den > 0 ? num / den : 0;
}

/** Track name from tags: an explicit title wins; MP4 track names usually live in handler_name. */
export function trackTitle(tags: ProbeStream["tags"]): string | null {
  const title = tags?.title?.trim();
  if (title) return title;
  const handler = tags?.handler_name?.trim();
  return handler && !GENERIC_HANDLER.test(handler) ? handler : null;
}

export function parseProbe(json: string, path: string): MediaInfo {
  const data = JSON.parse(json) as ProbeJson;
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("no video stream");
  const audioTracks: AudioTrack[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s, index) => ({ index, title: trackTitle(s.tags), channels: s.channels ?? 2, codec: s.codec_name ?? "unknown" }));
  const fps = rate(video.avg_frame_rate) || rate(video.r_frame_rate);
  return {
    path,
    durationSec: Number(data.format?.duration ?? 0),
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: Math.round(fps * 1000) / 1000,
    videoCodec: video.codec_name ?? "unknown",
    hdr: HDR_TRANSFERS.has(video.color_transfer ?? ""),
    audioTracks,
  };
}
