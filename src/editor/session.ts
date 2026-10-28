// Opening a video: probe, restore its saved project, prepare the preview, keep it auto-saved.
import { appCacheDir, appDataDir, join } from "@tauri-apps/api/path";
import { create } from "zustand";
import {
  decodeEnvelope, mediaKey, parseProject, previewAudioArgs, previewFiles, proxyArgs,
  type MediaInfo, type ProjectFile,
} from "../core";
import {
  allowAsset, assetUrl, createRunner, ensureDir, fileStat, pathExists, probeMedia, pruneDirs, readBytes, readText, writeText,
} from "../platform/tauri";
import { useApp } from "./app";
import { playback } from "./playback";
import { editor, useEditor } from "./store";

const MAX_RECENTS = 10;
/** Preview folders (extracted audio, proxies) kept besides the open one. */
const KEEP_PREVIEWS = 5;
const SAVE_DEBOUNCE_MS = 400;
// Bump when the preview files change shape so stale caches are rebuilt.
const PREVIEW_VERSION = "1";

let generation = 0;
let activeJob: { cancel(): Promise<boolean> } | null = null;

const previewRoot = async () => join(await appCacheDir(), "preview");
const previewDir = async (key: string) => join(await previewRoot(), key);
const projectPath = async (key: string) => join(await appDataDir(), "projects", `${key}.json`);
const recentsPath = async () => join(await appDataDir(), "recent.json");

export const useRecents = create<{ paths: string[] }>(() => ({ paths: [] }));

export async function loadRecents() {
  try {
    const raw = JSON.parse((await readText(await recentsPath())) ?? "[]");
    if (Array.isArray(raw)) useRecents.setState({ paths: raw.filter((p): p is string => typeof p === "string") });
  } catch {
    // A corrupt list is just forgotten.
  }
}

async function addRecent(path: string) {
  const paths = [path, ...useRecents.getState().paths.filter((p) => p !== path)].slice(0, MAX_RECENTS);
  useRecents.setState({ paths });
  await writeText(await recentsPath(), JSON.stringify(paths));
}

export async function forgetRecent(path: string) {
  const paths = useRecents.getState().paths.filter((p) => p !== path);
  useRecents.setState({ paths });
  await writeText(await recentsPath(), JSON.stringify(paths));
}

export async function openMedia(path: string): Promise<void> {
  const gen = ++generation;
  await flushSave();
  playback.pause();
  playback.unloadAudio();
  void activeJob?.cancel();
  activeJob = null;

  const [media, stat] = await Promise.all([probeMedia(path), fileStat(path)]);
  if (gen !== generation) return;
  const key = mediaKey(path, stat.size, stat.mtimeMs);
  const saved = parseProject((await readText(await projectPath(key))) ?? "", media.audioTracks.length);
  await allowAsset(path);
  if (gen !== generation) return;

  editor.reset({
    media, key,
    cuts: saved?.cuts ?? [],
    selectedId: saved?.cuts[0]?.id ?? null,
    mix: saved?.mix ?? media.audioTracks.map(() => ({ enabled: true, volume: 1 })),
    presetId: saved?.presetId ?? useApp.getState().settings.defaultPreset,
    mode: saved?.mode ?? "separate",
    keepSeparateTracks: saved?.keepSeparateTracks ?? false,
    video: { source: "original", src: assetUrl(path), progress: 0 },
  });
  void addRecent(path);
  void prepareAudio(media, key, gen);
}

export function closeMedia() {
  void flushSave();
  generation++;
  void activeJob?.cancel();
  activeJob = null;
  playback.pause();
  playback.unloadAudio();
  editor.reset();
}

async function prepareAudio(media: MediaInfo, key: string, gen: number) {
  if (media.audioTracks.length === 0) return editor.setAudio({ status: "ready", progress: 1 });
  try {
    const dir = await previewDir(key);
    const marker = await join(dir, `audio-v${PREVIEW_VERSION}.done`);
    const files = previewFiles(dir, media.audioTracks.length, dir.includes("\\") ? "\\" : "/");
    if (!(await pathExists(marker))) {
      await ensureDir(dir);
      editor.setAudio({ status: "extracting", progress: 0 });
      const runner = createRunner(crypto.randomUUID(), (sec) => {
        if (gen === generation) editor.setAudio({ status: "extracting", progress: Math.min(1, sec / media.durationSec) });
      });
      activeJob = runner;
      await runner.run(previewAudioArgs(media, files));
      await writeText(marker, "");
    }
    if (gen !== generation) return;
    void pruneDirs(await previewRoot(), KEEP_PREVIEWS, key);
    const envelopes = await Promise.all(files.envelope.map(async (f) => decodeEnvelope(await readBytes(f))));
    if (gen !== generation) return;
    editor.setEnvelopes(envelopes);
    playback.loadAudio(files.audio.map(assetUrl));
    editor.setAudio({ status: "ready", progress: 1 });
  } catch (e) {
    if (gen === generation) editor.setAudio({ status: "failed", progress: 0, error: String(e) });
  }
}

/** Called when the WebView cannot decode the source: builds and switches to an H.264 540p preview. */
export async function buildProxy() {
  const { media, key, video } = useEditor.getState();
  if (!media || !key || video.source !== "original") return;
  const gen = generation;
  try {
    const dir = await previewDir(key);
    const out = await join(dir, "proxy.mp4");
    const marker = await join(dir, `proxy-v${PREVIEW_VERSION}.done`);
    if (!(await pathExists(marker))) {
      await ensureDir(dir);
      editor.setVideo({ source: "building", progress: 0 });
      // Runs alongside audio extraction; its own job id keeps the two cancellable separately.
      const runner = createRunner(crypto.randomUUID(), (sec) => {
        if (gen === generation) editor.setVideo({ progress: Math.min(1, sec / media.durationSec) });
      });
      await runner.run(proxyArgs(media, out));
      await writeText(marker, "");
    }
    if (gen === generation) editor.setVideo({ source: "proxy", src: assetUrl(out), progress: 1 });
  } catch (e) {
    if (gen === generation) editor.setVideo({ source: "failed", error: String(e) });
  }
}

// Auto-save (FR-13): any change to the project fields is written shortly after it happens.
let saveTimer = 0;
let pendingSave: (() => Promise<void>) | null = null;

async function flushSave() {
  clearTimeout(saveTimer);
  const save = pendingSave;
  pendingSave = null;
  await save?.().catch(() => {});
}

useEditor.subscribe((s, prev) => {
  if (!s.media || !s.key || s.key !== prev.key) return;
  if (s.cuts === prev.cuts && s.mix === prev.mix && s.presetId === prev.presetId && s.mode === prev.mode
    && s.keepSeparateTracks === prev.keepSeparateTracks) return;
  const file: ProjectFile = {
    version: 1, path: s.media.path, cuts: s.cuts, mix: s.mix,
    presetId: s.presetId, mode: s.mode, keepSeparateTracks: s.keepSeparateTracks,
  };
  const key = s.key;
  pendingSave = async () => writeText(await projectPath(key), JSON.stringify(file, null, 2));
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
});
