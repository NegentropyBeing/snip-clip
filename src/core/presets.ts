import type { Preset, PresetId } from "./types";

// Limits use decimal megabytes: the conservative reading of Discord's "20 MB".
const MB = 1_000_000;

export const PRESETS: Record<PresetId, Preset> = {
  "discord-20": { id: "discord-20", sizeLimitBytes: 20 * MB, codec: "h264", mixAudio: true, allowsMontage: true },
  "discord-20-av1": { id: "discord-20-av1", sizeLimitBytes: 20 * MB, codec: "av1", mixAudio: true, allowsMontage: true },
  "nitro-basic-50": { id: "nitro-basic-50", sizeLimitBytes: 50 * MB, codec: "h264", mixAudio: true, allowsMontage: true },
  "nitro-500": { id: "nitro-500", sizeLimitBytes: 500 * MB, codec: "h264", mixAudio: true, allowsMontage: true },
  unlimited: { id: "unlimited", sizeLimitBytes: null, codec: "av1", mixAudio: true, allowsMontage: true },
  // Stream copy cannot join cuts without temporary files; v0.1 exports cuts separately.
  original: { id: "original", sizeLimitBytes: null, codec: "copy", mixAudio: false, allowsMontage: false },
};

export const DEFAULT_PRESET: PresetId = "discord-20";

/** Order in menus. */
export const PRESET_ORDER: PresetId[] = ["discord-20", "discord-20-av1", "nitro-basic-50", "nitro-500", "unlimited", "original"];
