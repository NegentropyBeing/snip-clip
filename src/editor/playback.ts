// Live preview: the <video> plays muted and is the clock; each audio track plays from its own
// extracted file through a Web Audio gain node, re-synced to the video on every seek, stall and drift.
import type { TrackMix } from "../core";
import { editor, useEditor } from "./store";

const DRIFT_SEC = 0.12;
const DRIFT_CHECK_MS = 250;
const JOG_RATES = [1, 2, 4, 8];
const JOG_TICK_MS = 1000 / 30;

interface Track {
  el: HTMLAudioElement;
  gain: GainNode;
}

class Playback {
  private video: HTMLVideoElement | null = null;
  private ctx: AudioContext | null = null;
  private tracks: Track[] = [];
  private raf = 0;
  private driftTimer = 0;
  private reverseTimer = 0;
  private reverseRate = 0;
  private detachVideo: (() => void) | null = null;

  constructor() {
    useEditor.subscribe((s, prev) => {
      if (s.mix !== prev.mix) this.applyMix(s.mix);
    });
  }

  attach(video: HTMLVideoElement) {
    this.detachVideo?.();
    this.video = video;
    video.muted = true;
    const onWaiting = () => this.tracks.forEach((t) => t.el.pause());
    const onPlaying = () => this.resyncAudio(true);
    const onSeeked = () => editor.setTime(video.currentTime);
    const onEnded = () => this.pause();
    const onLoaded = () => {
      // A new source (e.g. the proxy replacing the original) resumes where the user was.
      const t = useEditor.getState().time;
      if (t > 0) video.currentTime = Math.min(t, video.duration || t);
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("loadedmetadata", onLoaded);
    this.detachVideo = () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadedmetadata", onLoaded);
    };
  }

  detach(video: HTMLVideoElement) {
    if (this.video !== video) return;
    this.pause();
    this.detachVideo?.();
    this.detachVideo = null;
    this.video = null;
  }

  loadAudio(urls: string[]) {
    this.unloadAudio();
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    this.tracks = urls.map((url) => {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.src = url;
      const gain = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
      return { el, gain };
    });
    this.applyMix(useEditor.getState().mix);
    if (this.video) {
      this.tracks.forEach((t) => (t.el.currentTime = this.video!.currentTime));
      if (!this.video.paused) this.resyncAudio(true);
    }
  }

  unloadAudio() {
    for (const t of this.tracks) {
      t.el.pause();
      t.el.removeAttribute("src");
      t.el.load();
      t.gain.disconnect();
    }
    this.tracks = [];
  }

  private applyMix(mix: readonly TrackMix[]) {
    this.tracks.forEach((t, i) => {
      const m = mix[i];
      t.gain.gain.value = m?.enabled ? m.volume : 0;
    });
  }

  private resyncAudio(play: boolean) {
    const v = this.video;
    if (!v) return;
    for (const t of this.tracks) {
      if (Math.abs(t.el.currentTime - v.currentTime) > DRIFT_SEC) t.el.currentTime = v.currentTime;
      t.el.playbackRate = v.playbackRate;
      if (play && t.el.paused) t.el.play().catch(() => {});
    }
  }

  private startClock() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.video) editor.setTime(this.video.currentTime);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    clearInterval(this.driftTimer);
    this.driftTimer = window.setInterval(() => {
      if (this.video && !this.video.paused) this.resyncAudio(false);
    }, DRIFT_CHECK_MS);
  }

  private stopClock() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.driftTimer);
    if (this.video) editor.setTime(this.video.currentTime);
  }

  private stopReverse() {
    clearInterval(this.reverseTimer);
    this.reverseRate = 0;
  }

  play(rate = 1) {
    const v = this.video;
    if (!v) return;
    this.stopReverse();
    if (v.ended || v.currentTime >= v.duration - 0.05) v.currentTime = 0;
    void this.ctx?.resume();
    v.playbackRate = rate;
    v.play().then(() => this.resyncAudio(true)).catch(() => {});
    editor.setPlaying(true, rate);
    this.startClock();
  }

  pause() {
    this.stopReverse();
    this.video?.pause();
    this.tracks.forEach((t) => t.el.pause());
    this.stopClock();
    editor.setPlaying(false);
  }

  toggle() {
    if (useEditor.getState().playing) this.pause();
    else this.play();
  }

  seek(sec: number) {
    const v = this.video;
    if (!v) return;
    const t = Math.min(Math.max(0, sec), v.duration || useEditor.getState().media?.durationSec || 0);
    v.currentTime = t;
    this.tracks.forEach((tr) => (tr.el.currentTime = t));
    editor.setTime(t);
  }

  nudge(deltaSec: number) {
    this.seek((this.video?.currentTime ?? 0) + deltaSec);
  }

  step(frames: number) {
    if (useEditor.getState().playing) this.pause();
    const fps = useEditor.getState().media?.fps || 30;
    this.nudge(frames / fps);
  }

  /** L: play forward; pressing again while playing doubles the speed (up to 8×). */
  jogForward() {
    const { playing, rate } = useEditor.getState();
    const next = playing && !this.reverseRate ? JOG_RATES[Math.min(JOG_RATES.indexOf(rate) + 1, JOG_RATES.length - 1)] : 1;
    this.play(next);
  }

  /** J: scrub backwards (media elements cannot play in reverse); repeating doubles the speed. */
  jogBackward() {
    const next = this.reverseRate ? JOG_RATES[Math.min(JOG_RATES.indexOf(this.reverseRate) + 1, JOG_RATES.length - 1)] : 1;
    this.pause();
    this.reverseRate = next;
    editor.setPlaying(true, -next);
    this.reverseTimer = window.setInterval(() => {
      const v = this.video;
      if (!v || v.currentTime <= 0) return this.pause();
      this.seek(v.currentTime - (this.reverseRate * JOG_TICK_MS) / 1000);
    }, JOG_TICK_MS);
  }
}

export const playback = new Playback();
