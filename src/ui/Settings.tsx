import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ENCODER_NAMES, PRESET_ORDER, type EncoderBackend, type EncoderPreference, type PresetId } from "../core";
import { checkForUpdate, defaultExportDir, openSettings, updateSettings, useApp, type Language, type Theme } from "../editor/app";
import { Button, IconButton, Row, Select } from "./common";
import { CloseIcon } from "./icons";
import { RecordingTab } from "./RecordingTab";

type Tab = "general" | "recording";

const GPU_LABELS: Partial<Record<EncoderBackend, string>> = { nvenc: "NVIDIA NVENC", amf: "AMD AMF", qsv: "Intel Quick Sync" };

export function SettingsDialog() {
  const { t } = useTranslation();
  const s = useApp((st) => st.settings);
  const encoders = useApp((st) => st.encoders);
  const ffmpeg = useApp((st) => st.ffmpeg);
  const version = useApp((st) => st.version);
  const update = useApp((st) => st.update);
  const [defaultDir, setDefaultDir] = useState("");
  const [checking, setChecking] = useState<"idle" | "busy" | "none" | "failed">("idle");
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    void defaultExportDir().then(setDefaultDir);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickDir = async () => {
    const dir = await open({ directory: true, defaultPath: s.exportDir ?? defaultDir });
    if (typeof dir === "string") await updateSettings({ exportDir: dir });
  };

  const check = async () => {
    setChecking("busy");
    try {
      setChecking((await checkForUpdate()) ? "idle" : "none");
    } catch {
      setChecking("failed");
    }
  };

  const gpus = (Object.keys(GPU_LABELS) as EncoderBackend[])
    .filter((b) => encoders && (encoders.has(ENCODER_NAMES.h264[b]) || encoders.has(ENCODER_NAMES.av1[b])))
    .map((b) => GPU_LABELS[b]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && openSettings(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex max-h-full w-full max-w-2xl flex-col rounded-xl bg-neutral-50 shadow-2xl dark:bg-neutral-900">
        <header className="flex items-center border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <h1 id="settings-title" className="text-lg font-semibold">{t("settings.title")}</h1>
          <IconButton label={t("settings.close")} className="ml-auto" onClick={() => openSettings(false)}><CloseIcon /></IconButton>
        </header>
        <div role="tablist" className="flex gap-1 border-b border-neutral-200 px-5 dark:border-neutral-800">
          {(["general", "recording"] as const).map((id) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id
                ? "border-brand-500 text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
            >
              {t(`settings.tabs.${id}`)}
            </button>
          ))}
        </div>
        {tab === "recording" ? (
          <div role="tabpanel" className="overflow-y-auto px-5"><RecordingTab /></div>
        ) : (
          <div role="tabpanel" className="divide-y divide-neutral-200 overflow-y-auto px-5 dark:divide-neutral-800">
            <Row label={t("settings.exportDir")}>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800" title={s.exportDir ?? defaultDir}>
                  {s.exportDir ?? defaultDir}
                </code>
                <Button onClick={() => void pickDir()}>{t("settings.change")}</Button>
                {s.exportDir && <Button variant="ghost" onClick={() => void updateSettings({ exportDir: null })}>{t("settings.reset")}</Button>}
              </div>
            </Row>

            <Row label={t("settings.defaultPreset")} hint={t("settings.defaultPresetHint")}>
              <Select<PresetId> value={s.defaultPreset} options={PRESET_ORDER.map((id) => [id, t(`presets.${id}`)])} onChange={(defaultPreset) => void updateSettings({ defaultPreset })} />
            </Row>

            <Row label={t("settings.afterExport")}>
              <label className="flex items-center gap-2 pt-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={s.copyAfterExport} onChange={(e) => void updateSettings({ copyAfterExport: e.target.checked })} />
                {t("settings.copyAfterExport")}
              </label>
            </Row>

            <Row
              label={t("settings.encoder")}
              hint={<>{t(`settings.encoderHint.${s.encoder}`)} {t("settings.gpusFound", { list: gpus.length ? gpus.join(", ") : t("settings.noGpu") })}</>}
            >
              <Select<EncoderPreference>
                value={s.encoder}
                options={(["auto", "gpu", "cpu"] as const).map((v) => [v, t(`settings.encoders.${v}`)])}
                onChange={(encoder) => void updateSettings({ encoder })}
              />
            </Row>

            <Row label={t("settings.language")}>
              <Select<Language>
                value={s.language}
                options={[["system", t("settings.system")], ["en", "English"], ["pt-BR", "Português (Brasil)"]]}
                onChange={(language) => void updateSettings({ language })}
              />
            </Row>

            <Row label={t("settings.theme")}>
              <Select<Theme>
                value={s.theme}
                options={[["system", t("settings.system")], ["light", t("settings.light")], ["dark", t("settings.dark")]]}
                onChange={(theme) => void updateSettings({ theme })}
              />
            </Row>

            <Row
              label={t("settings.updates")}
              hint={
                update ? (
                  <button type="button" className="text-brand2-600 hover:underline dark:text-brand2-400" onClick={() => void openUrl(update.url)}>
                    {t("update.available", { version: update.version })}
                  </button>
                ) : checking === "none" ? t("settings.upToDate") : checking === "failed" ? t("settings.checkFailed") : t("settings.updatesHint")
              }
            >
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={s.checkUpdates} onChange={(e) => void updateSettings({ checkUpdates: e.target.checked })} />
                  {t("settings.checkOnStart")}
                </label>
                <Button className="ml-auto" disabled={checking === "busy"} onClick={() => void check()}>{t("settings.checkNow")}</Button>
              </div>
            </Row>

            <Row label="FFmpeg">
              <p className="pt-1.5 text-sm">
                {ffmpeg ? `${ffmpeg.version} · ${t(`settings.ffmpegSource.${ffmpeg.source}`)}` : "—"}
              </p>
              {ffmpeg && <p className="truncate font-mono text-xs text-neutral-500" title={ffmpeg.ffmpeg}>{ffmpeg.ffmpeg}</p>}
            </Row>
          </div>
        )}
        <footer className="border-t border-neutral-200 px-5 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          snip-clip {version} · GPL-3.0 · {t("settings.noTelemetry")}
        </footer>
      </div>
    </div>
  );
}
