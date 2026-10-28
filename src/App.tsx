import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ffmpegReady, initApp, openSettings, useApp } from "./editor/app";
import { closeMedia, forgetRecent, loadRecents, openMedia, useRecents } from "./editor/session";
import { useEditor } from "./editor/store";
import { Badge } from "./ui/Brand";
import { cancelFfmpegDownload, downloadFfmpeg, ffmpegDownloadInfo, type DownloadProgress, type FfmpegDownloadInfo } from "./platform/tauri";
import { Button, IconButton, Kbd, ProgressBar } from "./ui/common";
import { Player, Transport } from "./ui/Player";
import { ShortcutBar, useShortcuts } from "./ui/shortcuts";
import { CutList, ExportPanel, TrackMixer } from "./ui/Sidebar";
import { Timeline } from "./ui/Timeline";
import { CloseIcon, GearIcon } from "./ui/icons";
import { SettingsDialog } from "./ui/Settings";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "avi", "flv", "ts", "m4v"];

export default function App() {
  const { t } = useTranslation();
  const ffmpeg = useApp((s) => s.ffmpeg);
  const hasMedia = useEditor((s) => s.media !== null);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const notice = useApp((s) => s.notice);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void initApp();
    void loadRecents();
  }, []);

  const openPath = useCallback(async (path: string) => {
    setError(null);
    try {
      await openMedia(path);
    } catch (e) {
      setError(`${t("editor.openFailed")}: ${String(e)}`);
    }
  }, [t]);

  const pickFile = useCallback(async () => {
    if (!useApp.getState().ffmpeg) return;
    const path = await open({ multiple: false, filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] });
    if (typeof path === "string") await openPath(path);
  }, [openPath]);

  useShortcuts(pickFile);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        const path = e.payload.paths[0];
        if (path && useApp.getState().ffmpeg) void openPath(path);
      }
    });
    return () => void unlisten.then((f) => f());
  }, [openPath]);

  return (
    <div className="flex h-full flex-col bg-neutral-50 font-sans text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      {ffmpeg === undefined && <Centered><p className="text-neutral-500">{t("app.loading")}</p></Centered>}
      {ffmpeg === null && <FfmpegMissing />}
      {ffmpeg && !hasMedia && <Welcome onOpen={pickFile} onOpenPath={openPath} />}
      {ffmpeg && hasMedia && <Editor onOpen={pickFile} />}
      {settingsOpen && <SettingsDialog />}
      {notice && (
        <div
          className={`fixed bottom-12 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-md px-3 py-2 text-sm text-white shadow-lg ${notice.error ? "bg-red-600" : "bg-neutral-800 dark:bg-neutral-700"}`}
          onClick={() => useApp.setState({ notice: null })}
        >
          {notice.text}
        </div>
      )}
      {error && (
        <div className="fixed bottom-12 left-1/2 z-20 max-w-xl -translate-x-1/2 rounded-md bg-red-600 px-3 py-2 text-sm text-white shadow-lg" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {dragging && ffmpeg && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-brand-500/20 backdrop-blur-[1px]">
          <div className="rounded-xl border-2 border-dashed border-brand-400 bg-neutral-900/80 px-8 py-6 text-lg font-medium text-white">{t("app.dropHere")}</div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8">{children}</div>;
}

const isWindows = navigator.userAgent.includes("Windows");
const isMac = navigator.userAgent.includes("Mac");
const MANUAL_COMMAND = isWindows ? "winget install Gyan.FFmpeg" : isMac ? "brew install ffmpeg" : "sudo apt install ffmpeg";
const mb = (bytes: number) => Math.round(bytes / 1e6);

/** First-run screen (FR-30, FR-32): why FFmpeg is needed, where it comes from, how big it is. */
function FfmpegMissing() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<FfmpegDownloadInfo | null | undefined>(undefined);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [stillMissing, setStillMissing] = useState(false);

  useEffect(() => {
    void ffmpegDownloadInfo().then(setInfo, () => setInfo(null));
  }, []);

  const download = async () => {
    setFailed(null);
    setProgress({ stage: "download", received: 0, total: info?.bytes ?? 0 });
    try {
      await ffmpegReady(await downloadFfmpeg(setProgress));
    } catch (e) {
      if (!String(e).includes("cancelled")) setFailed(String(e));
      setProgress(null);
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(MANUAL_COMMAND).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const retry = async () => {
    setRetrying(true);
    await initApp();
    setRetrying(false);
    setStillMissing(!useApp.getState().ffmpeg);
  };

  return (
    <Centered>
      <div className="max-w-lg space-y-3">
        <Badge className="mb-3 h-14" />
        <h1 className="text-xl font-semibold">{t("ffmpeg.missingTitle")}</h1>
        <p className="text-neutral-600 dark:text-neutral-300">{t("ffmpeg.missingBody")}</p>
        {info && (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {t("ffmpeg.downloadWhat", { version: info.version, origin: info.origin, size: mb(info.bytes) })}
            </p>
            {progress ? (
              <div className="space-y-1.5 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <ProgressBar value={progress.total ? progress.received / progress.total : 0} />
                <div className="flex items-center text-xs text-neutral-500">
                  <span>
                    {progress.stage === "extract"
                      ? t("ffmpeg.installing")
                      : t("ffmpeg.downloading", { received: mb(progress.received), total: mb(progress.total) })}
                  </span>
                  {progress.stage === "download" && (
                    <Button variant="ghost" className="ml-auto !py-0 text-xs" onClick={() => void cancelFfmpegDownload()}>{t("ffmpeg.cancel")}</Button>
                  )}
                </div>
              </div>
            ) : (
              <Button variant="primary" className="!px-4 !py-2" onClick={() => void download()}>
                {t("ffmpeg.download", { size: mb(info.bytes) })}
              </Button>
            )}
            {failed && <p className="text-sm text-red-600">{t("ffmpeg.downloadFailed")} {failed}</p>}
            <p className="text-xs text-neutral-500">{t("ffmpeg.license")}</p>
          </>
        )}
        <details className="text-sm text-neutral-600 dark:text-neutral-300" open={info === null}>
          <summary className="cursor-pointer select-none">{t("ffmpeg.manualTitle")}</summary>
          <div className="mt-2 space-y-2">
            <p>{t("ffmpeg.manualHow")}</p>
            <div className="flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 py-1.5 pl-3 pr-1.5 dark:border-neutral-700 dark:bg-neutral-800">
              <code className="flex-1 select-all font-mono text-sm">{MANUAL_COMMAND}</code>
              <Button variant="ghost" className="!py-1 text-xs" onClick={() => void copy()}>
                {copied ? t("ffmpeg.copied") : t("ffmpeg.copy")}
              </Button>
            </div>
            <Button disabled={retrying || progress !== null} onClick={() => void retry()}>{t("ffmpeg.retry")}</Button>
            {stillMissing && <p className="text-sm text-amber-700 dark:text-amber-300">{t("ffmpeg.stillMissing")}</p>}
          </div>
        </details>
      </div>
    </Centered>
  );
}

/** "Version X available" link, shown when the update check found a newer release. */
function UpdatePill() {
  const { t } = useTranslation();
  const update = useApp((s) => s.update);
  if (!update) return null;
  return (
    <button
      type="button"
      className="shrink-0 rounded-full bg-brand-gradient px-2.5 py-0.5 text-xs font-medium text-white hover:brightness-110"
      title={update.url}
      onClick={() => void openUrl(update.url)}
    >
      {t("update.available", { version: update.version })}
    </button>
  );
}

function SettingsButton() {
  const { t } = useTranslation();
  return <IconButton label={`${t("settings.title")} (Ctrl+,)`} onClick={() => openSettings()}><GearIcon /></IconButton>;
}

function Welcome({ onOpen, onOpenPath }: { onOpen: () => void; onOpenPath: (p: string) => void }) {
  const { t } = useTranslation();
  const recents = useRecents((s) => s.paths);
  return (
    <Centered>
      <div className="fixed right-3 top-2 flex items-center gap-2">
        <UpdatePill />
        <SettingsButton />
      </div>
      <div className="w-full max-w-lg">
        <Badge className="mb-6 h-20" />
        <h1 className="text-2xl font-semibold">{t("welcome.title")}</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-300">{t("welcome.subtitle")}</p>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" className="!px-4 !py-2" onClick={onOpen}>
            {t("welcome.open")} <Kbd>Ctrl+O</Kbd>
          </Button>
          <span className="text-sm text-neutral-500">{t("welcome.drop")}</span>
        </div>
        <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("welcome.recent")}</h2>
        {recents.length === 0 && <p className="text-sm text-neutral-500">{t("welcome.noRecent")}</p>}
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {recents.map((p) => (
            <li key={p} className="group flex items-center">
              <button type="button" className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => onOpenPath(p)} title={p}>
                <span className="block truncate text-sm font-medium">{p.split(/[\\/]/).pop()}</span>
                <span className="block truncate text-xs text-neutral-500">{p}</span>
              </button>
              <button type="button" className="px-3 text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100 dark:hover:text-neutral-200" title={t("welcome.forget")} onClick={() => void forgetRecent(p)}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Centered>
  );
}

function Editor({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const media = useEditor((s) => s.media)!;
  const name = media.path.split(/[\\/]/).pop();
  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <Badge className="h-7 shrink-0" />
        <span className="min-w-0 truncate text-sm" title={media.path}>{name}</span>
        <span className="shrink-0 text-xs text-neutral-500">
          {media.width}×{media.height} · {Math.round(media.fps * 100) / 100} fps · {media.videoCodec.toUpperCase()}
          {media.hdr && <span className="ml-1 rounded bg-amber-500 px-1 font-semibold text-black">{t("editor.hdr")}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <UpdatePill />
          <Button variant="ghost" onClick={onOpen} title={`${t("editor.open")} (Ctrl+O)`}>{t("editor.open")}</Button>
          <Button variant="ghost" onClick={closeMedia}>{t("editor.close")}</Button>
          <SettingsButton />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <Player />
          <Transport />
        </main>
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-neutral-200 dark:border-neutral-800">
          <TrackMixer />
          <CutList />
          <ExportPanel />
        </aside>
      </div>
      <Timeline />
      <ShortcutBar />
    </>
  );
}
