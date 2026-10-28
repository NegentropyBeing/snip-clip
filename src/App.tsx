import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { initApp, useApp } from "./editor/app";
import { closeMedia, forgetRecent, loadRecents, openMedia, useRecents } from "./editor/session";
import { useEditor } from "./editor/store";
import { Button, Kbd } from "./ui/common";
import { Player, Transport } from "./ui/Player";
import { ShortcutBar, useShortcuts } from "./ui/shortcuts";
import { CutList, ExportPanel, TrackMixer } from "./ui/Sidebar";
import { Timeline } from "./ui/Timeline";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "avi", "flv", "ts", "m4v"];

export default function App() {
  const { t } = useTranslation();
  const ffmpeg = useApp((s) => s.ffmpeg);
  const hasMedia = useEditor((s) => s.media !== null);
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
      {error && (
        <div className="fixed bottom-12 left-1/2 z-20 max-w-xl -translate-x-1/2 rounded-md bg-red-600 px-3 py-2 text-sm text-white shadow-lg" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {dragging && ffmpeg && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-indigo-600/20 backdrop-blur-[1px]">
          <div className="rounded-xl border-2 border-dashed border-indigo-400 bg-neutral-900/80 px-8 py-6 text-lg font-medium text-white">{t("app.dropHere")}</div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8">{children}</div>;
}

function FfmpegMissing() {
  const { t } = useTranslation();
  return (
    <Centered>
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold">{t("ffmpeg.missingTitle")}</h1>
        <p className="text-neutral-600 dark:text-neutral-300">{t("ffmpeg.missingBody")}</p>
        <p className="text-sm text-neutral-500">{t("ffmpeg.missingHow")}</p>
        <Button variant="primary" onClick={() => void initApp()}>{t("ffmpeg.retry")}</Button>
      </div>
    </Centered>
  );
}

function Welcome({ onOpen, onOpenPath }: { onOpen: () => void; onOpenPath: (p: string) => void }) {
  const { t } = useTranslation();
  const recents = useRecents((s) => s.paths);
  return (
    <Centered>
      <div className="w-full max-w-lg">
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
                ✕
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
        <span className="font-semibold">clip-snip</span>
        <span className="min-w-0 truncate text-sm" title={media.path}>{name}</span>
        <span className="shrink-0 text-xs text-neutral-500">
          {media.width}×{media.height} · {Math.round(media.fps * 100) / 100} fps · {media.videoCodec.toUpperCase()}
          {media.hdr && <span className="ml-1 rounded bg-amber-500 px-1 font-semibold text-black">{t("editor.hdr")}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={onOpen} title={`${t("editor.open")} (Ctrl+O)`}>{t("editor.open")}</Button>
          <Button variant="ghost" onClick={closeMedia}>{t("editor.close")}</Button>
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
