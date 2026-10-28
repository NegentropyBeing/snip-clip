import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatTimecode } from "../core";
import { playback } from "../editor/playback";
import { buildProxy } from "../editor/session";
import { editor, useEditor } from "../editor/store";
import { IconButton, Kbd } from "./common";
import { FrameBackIcon, FrameForwardIcon, PauseIcon, PlayIcon } from "./icons";

export function Player() {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  const src = useEditor((s) => s.video.src);
  const video = useEditor((s) => s.video);
  const audio = useEditor((s) => s.audio);
  const codec = useEditor((s) => s.media?.videoCodec ?? "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    playback.attach(el);
    return () => playback.detach(el);
  }, []);

  // A source that loads but never yields a frame is as undecodable as one that errors.
  const onLoadedData = () => {
    if (ref.current && ref.current.videoWidth === 0) void buildProxy();
  };

  const notices: { text: string; tone: "info" | "warn" | "error" }[] = [];
  if (audio.status === "extracting") notices.push({ text: t("player.preparingAudio", { pct: Math.round(audio.progress * 100) }), tone: "info" });
  if (audio.status === "failed") notices.push({ text: t("player.audioFailed", { error: audio.error }), tone: "error" });
  if (video.source === "building") notices.push({ text: t("player.buildingProxy", { codec: codec.toUpperCase(), pct: Math.round(video.progress * 100) }), tone: "warn" });
  if (video.source === "proxy") notices.push({ text: t("player.proxyActive"), tone: "info" });
  if (video.source === "failed") notices.push({ text: t("player.proxyFailed", { error: video.error }), tone: "error" });

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        ref={ref}
        src={src ?? undefined}
        className="max-h-full max-w-full"
        preload="auto"
        playsInline
        onClick={() => playback.toggle()}
        onError={() => void buildProxy()}
        onLoadedData={onLoadedData}
      />
      {notices.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 p-2">
          {notices.map((n) => (
            <div
              key={n.text}
              className={`max-w-xl rounded-md px-3 py-1.5 text-center text-xs shadow ${
                n.tone === "error" ? "bg-red-600/90 text-white" : n.tone === "warn" ? "bg-amber-500/90 text-black" : "bg-neutral-900/80 text-neutral-100"
              }`}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Transport() {
  const { t } = useTranslation();
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const duration = useEditor((s) => s.media?.durationSec ?? 0);
  const markIn = useEditor((s) => s.markIn);
  const markOut = useEditor((s) => s.markOut);

  return (
    <div className="flex items-center gap-1 border-t border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
      <IconButton label={`${t("player.frameBack")} (←)`} onClick={() => playback.step(-1)}><FrameBackIcon /></IconButton>
      <button
        type="button"
        title={`${playing ? t("player.pause") : t("player.play")} (Space)`}
        aria-label={playing ? t("player.pause") : t("player.play")}
        onClick={() => playback.toggle()}
        className="bg-brand-gradient mx-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-lg text-white shadow-sm transition hover:brightness-110"
      >
        {playing ? <PauseIcon /> : <span className="translate-x-px"><PlayIcon /></span>}
      </button>
      <IconButton label={`${t("player.frameForward")} (→)`} onClick={() => playback.step(1)}><FrameForwardIcon /></IconButton>
      <span className="ml-2 font-mono text-sm tabular-nums">
        {formatTimecode(time)} <span className="text-neutral-400">/ {formatTimecode(duration)}</span>
      </span>
      {playing && rate !== 1 && <span className="ml-2 rounded bg-brand-gradient px-1.5 text-xs font-semibold text-white">{rate}×</span>}
      <div className="ml-auto flex items-center gap-1.5 text-xs">
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.markIn(time)} title={t("player.markIn")}>
          <Kbd>I</Kbd>
          <span className="font-mono tabular-nums text-neutral-500">{markIn === null ? "--:--" : formatTimecode(markIn)}</span>
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => editor.markOut(time)} title={t("player.markOut")}>
          <Kbd>O</Kbd>
          <span className="font-mono tabular-nums text-neutral-500">{markOut === null ? "--:--" : formatTimecode(markOut)}</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
          disabled={markIn === null && markOut === null}
          onClick={() => editor.confirmMarks()}
          title={t("player.confirm")}
        >
          <Kbd>Enter</Kbd>
          <span>{t("player.confirm")}</span>
        </button>
      </div>
    </div>
  );
}
