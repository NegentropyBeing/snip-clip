import { create } from "zustand";
import {
  DEFAULT_PRESET, moveItem, normalizeCut, setEdge, shiftCut,
  type Cut, type MediaInfo, type OutputMode, type PresetId, type TrackMix,
} from "../core";

export type PreviewAudio = { status: "idle" | "extracting" | "ready" | "failed"; progress: number; error?: string };
/** "original" plays the source; "proxy" plays the generated H.264 540p preview (FR-6). */
export type PreviewVideo = { source: "original" | "building" | "proxy" | "failed"; src: string | null; progress: number; error?: string };

interface EditorState {
  media: MediaInfo | null;
  /** mediaKey() of the open file; also names its cache and project files. */
  key: string | null;
  cuts: Cut[];
  selectedId: string | null;
  mix: TrackMix[];
  presetId: PresetId;
  mode: OutputMode;
  keepSeparateTracks: boolean;
  /** In/out marks set with I/O, confirmed into a cut with Enter. */
  markIn: number | null;
  markOut: number | null;
  time: number;
  playing: boolean;
  rate: number;
  audio: PreviewAudio;
  video: PreviewVideo;
  /** Per-track loudness envelopes for the waveform. */
  envelopes: (Float32Array | undefined)[];
  /** Pixels per second on the timeline; 0 = fit to width. */
  zoom: number;
}

const initial: EditorState = {
  media: null, key: null, cuts: [], selectedId: null, mix: [],
  presetId: DEFAULT_PRESET, mode: "separate", keepSeparateTracks: false,
  markIn: null, markOut: null, time: 0, playing: false, rate: 1,
  audio: { status: "idle", progress: 0 }, video: { source: "original", src: null, progress: 0 },
  envelopes: [], zoom: 0,
};

export const useEditor = create<EditorState>(() => initial);

const set = useEditor.setState;
const get = useEditor.getState;
const duration = () => get().media?.durationSec ?? 0;

export const editor = {
  reset: (patch: Partial<EditorState> = {}) => set({ ...initial, ...patch }),

  addCut(startSec: number, endSec: number): Cut {
    const cut = normalizeCut({ id: crypto.randomUUID(), name: "", startSec, endSec }, duration());
    set((s) => ({ cuts: [...s.cuts, cut], selectedId: cut.id, markIn: null, markOut: null }));
    return cut;
  },
  updateCut(id: string, patch: Partial<Omit<Cut, "id">>) {
    set((s) => ({ cuts: s.cuts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  },
  setCutEdge(id: string, edge: "start" | "end", sec: number) {
    set((s) => ({ cuts: s.cuts.map((c) => (c.id === id ? setEdge(c, edge, sec, duration()) : c)) }));
  },
  shiftCut(id: string, base: Cut, deltaSec: number) {
    set((s) => ({ cuts: s.cuts.map((c) => (c.id === id ? shiftCut(base, deltaSec, duration()) : c)) }));
  },
  removeCut(id: string) {
    set((s) => {
      const i = s.cuts.findIndex((c) => c.id === id);
      const cuts = s.cuts.filter((c) => c.id !== id);
      const next = cuts[Math.min(i, cuts.length - 1)];
      return { cuts, selectedId: s.selectedId === id ? (next?.id ?? null) : s.selectedId };
    });
  },
  moveCut(id: string, by: number) {
    set((s) => {
      const i = s.cuts.findIndex((c) => c.id === id);
      return { cuts: moveItem(s.cuts, i, i + by) };
    });
  },
  select: (id: string | null) => set({ selectedId: id }),

  markIn: (sec: number) => set((s) => ({ markIn: sec, markOut: s.markOut !== null && s.markOut <= sec ? null : s.markOut })),
  markOut: (sec: number) => set((s) => ({ markOut: sec, markIn: s.markIn !== null && s.markIn >= sec ? null : s.markIn })),
  clearMarks: () => set({ markIn: null, markOut: null }),
  /** Enter: turns the marks into a cut. A missing in-mark starts at 0, a missing out-mark ends at the playhead. */
  confirmMarks(): Cut | null {
    const { markIn, markOut, time } = get();
    if (markIn === null && markOut === null) return null;
    const start = markIn ?? 0;
    const end = markOut ?? (time > start ? time : duration());
    return editor.addCut(start, end);
  },

  setTrack(index: number, patch: Partial<TrackMix>) {
    set((s) => ({ mix: s.mix.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));
  },
  setPreset: (presetId: PresetId) => set({ presetId }),
  setMode: (mode: OutputMode) => set({ mode }),
  setKeepSeparateTracks: (keepSeparateTracks: boolean) => set({ keepSeparateTracks }),
  setZoom: (zoom: number) => set({ zoom }),

  setTime: (time: number) => set({ time }),
  setPlaying: (playing: boolean, rate = 1) => set({ playing, rate }),
  setAudio: (audio: PreviewAudio) => set({ audio }),
  setVideo: (video: Partial<PreviewVideo>) => set((s) => ({ video: { ...s.video, ...video } })),
  setEnvelopes: (envelopes: (Float32Array | undefined)[]) => set({ envelopes }),
};
