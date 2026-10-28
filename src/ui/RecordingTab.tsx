// Settings → Recording: install and manage the replay profile in OBS (spec §16).
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BROWSERS, defaultMemoryMb, formatHotkey, hotkeyFromKeyPress, pickRecordingEncoder, RECORDING_ENCODERS, recordingEncoders,
  type Browser, type ObsHotkey, type RecordingEncoder, type ReplayProfileOptions,
} from "../core";
import { notify, useApp } from "../editor/app";
import {
  hotkeyMode, installReplayProfile, loadReplayOptions, obsLaunch, obsSetAutostart, obsStatus, recordingEncodersUsable,
  recordingEnv, removeReplayProfile, trackLang, type ObsStatus,
} from "../editor/recording";
import { Button, Row, Select, selectClass } from "./common";

type Form = Omit<ReplayProfileOptions, "encoder"> & { encoder: RecordingEncoder | "auto" };

const BROWSER_LABELS: Record<Browser, string> = { chrome: "Chrome", brave: "Brave", opera: "Opera", vivaldi: "Vivaldi", firefox: "Firefox", zen: "Zen" };
const OBS_DOWNLOAD = "https://obsproject.com/download";
const PLUGIN_PAGE = "https://github.com/dimtpap/obs-pipewire-audio-capture";
const STATUS_POLL_MS = 4000;

const linkClass = "text-brand2-600 hover:underline dark:text-brand2-400";
const inputClass = `${selectClass} w-24`;

/** A translated sentence with a command shown as code where it says {{command}}. */
function WithCommand({ text, command }: { text: string; command: string }) {
  const [before, after = ""] = text.split("\u0000");
  return <>{before}<code className="rounded bg-neutral-200 px-1 font-mono text-xs dark:bg-neutral-800">{command}</code>{after}</>;
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  const colors = tone === "warn"
    ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
    : "border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300";
  return <div className={`my-3 rounded-md border px-3 py-2 text-sm ${colors}`}>{children}</div>;
}

function NumberInput({ value, onChange, min, max, step = 1, placeholder }: {
  value: number | null; onChange: (v: number | null) => void; min: number; max: number; step?: number; placeholder?: string;
}) {
  return (
    <input
      type="number" className={inputClass} min={min} max={max} step={step} placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

/** Click, then press the keys. Keeps the keys from Settings and the editor while listening. */
function HotkeyInput({ value, onChange }: { value: ObsHotkey; onChange: (h: ObsHotkey) => void }) {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  return (
    <button
      type="button" className={`${selectClass} min-w-36 text-left font-mono`} aria-live="polite"
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={(e) => {
        if (!listening) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return setListening(false);
        const hotkey = hotkeyFromKeyPress(e);
        if (hotkey) {
          onChange(hotkey);
          setListening(false);
        }
      }}
    >
      {listening ? t("recording.pressKeys") : formatHotkey(value)}
    </button>
  );
}

function CopyCommand({ command }: { command: string }) {
  const { t } = useTranslation();
  const copy = () => navigator.clipboard.writeText(command).then(() => notify(t("recording.copied")), (e) => notify(String(e), true));
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-neutral-200 px-1.5 py-1 font-mono text-xs dark:bg-neutral-800" title={command}>{command}</code>
      <Button onClick={() => void copy()}>{t("recording.copy")}</Button>
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export function RecordingTab() {
  const { t } = useTranslation();
  const ffmpeg = useApp((s) => s.ffmpeg);
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [installed, setInstalled] = useState(false);
  const [autostart, setAutostart] = useState(false);
  /** undefined while testing; null without FFmpeg (every encoder is offered). */
  const [usable, setUsable] = useState<Set<string> | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** GNOME shortcuts already on the save-replay keys, found when installing. */
  const [conflicts, setConflicts] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const s = await obsStatus();
    setStatus(s);
    return s;
  }, []);

  const load = useCallback(async () => {
    const s = await refresh();
    if (s.platform === "macos" || !s.install) return;
    const loaded = await loadReplayOptions(s);
    setForm({ ...loaded.options, encoder: loaded.installed ? loaded.options.encoder : "auto" });
    setInstalled(loaded.installed);
    setAutostart(s.autostart);
    const probe = recordingEncodersUsable(recordingEnv(s).platform, s.vaapiDevice);
    setUsable(probe ? await probe : null);
  }, [refresh]);

  useEffect(() => {
    load().catch((e) => notify(String(e), true));
  }, [load, ffmpeg]);

  // OBS opened or closed meanwhile: installing and removing depend on it (FR-38).
  useEffect(() => {
    const tick = () => void refresh().catch(() => {});
    const timer = window.setInterval(tick, STATUS_POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  if (!status) return null;
  if (status.platform === "macos") return <Notice tone="info">{t("recording.notOnMac")}</Notice>;

  const platform = recordingEnv(status).platform;
  const cmd = (key: string, command: string) => <WithCommand text={t(key, { command: "\u0000" })} command={command} />;

  if (!status.install) {
    return (
      <div className="py-2">
        <Notice tone="warn">
          <p>{t("recording.obsMissing")}</p>
          <p className="mt-1">
            {platform === "windows" ? (
              <>{cmd("recording.installWindows", "winget install OBSProject.OBSStudio")}{" "}
                <button type="button" className={linkClass} onClick={() => void openUrl(OBS_DOWNLOAD)}>obsproject.com</button>.</>
            ) : cmd("recording.installLinux", "flatpak install flathub com.obsproject.Studio")}
          </p>
        </Notice>
        <Button onClick={() => void load().catch((e) => notify(String(e), true))}>{t("recording.checkAgain")}</Button>
      </div>
    );
  }

  if (!form) return null;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const locked = busy || status.running;
  const autoEncoder = pickRecordingEncoder(usable ?? new Set(), platform);
  const offered = recordingEncoders(platform).filter((e) => {
    const name = RECORDING_ENCODERS[e].ffmpeg;
    return usable === null || name === null || usable?.has(name) || e === form.encoder;
  });
  const showBrowsers = platform === "windows" || status.appAudioPlugin;
  const hotkeys = hotkeyMode(status);

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: form.replaysFolder });
    if (typeof dir === "string") set({ replaysFolder: dir });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
      void refresh().catch(() => {});
    }
  };

  const install = () => run(async () => {
    const s = await refresh();
    if (s.running) return;
    const options: ReplayProfileOptions = {
      ...form,
      encoder: form.encoder === "auto" ? autoEncoder : form.encoder,
      bufferSec: clamp(Math.round(form.bufferSec), 10, 3600),
      width: even(form.width),
      height: even(form.height),
      fps: clamp(Math.round(form.fps), 1, 240),
      quality: clamp(Math.round(form.quality), 1, 51),
      lang: trackLang(),
    };
    setConflicts((await installReplayProfile(options, s, autostart)).conflicts);
    notify(t(installed ? "recording.updated" : "recording.installed"));
    setInstalled(true);
  });

  const remove = () => run(async () => {
    const confirmed = await ask(t("recording.removeConfirm"), {
      kind: "warning", okLabel: t("recording.remove"), cancelLabel: t("recording.cancel"),
    });
    if (!confirmed) return;
    await removeReplayProfile(status);
    setInstalled(false);
    setConflicts([]);
    setAutostart(false);
    notify(t("recording.removed"));
  });

  const toggleAutostart = (enabled: boolean) => {
    setAutostart(enabled);
    // Before installing, the choice is applied with the install.
    if (installed) void run(() => obsSetAutostart(enabled));
  };

  return (
    <div>
      <Row label={t("recording.obs")}>
        <p className="pt-1.5 text-sm">
          {t(`recording.kind.${status.install.kind}`)} · {t(status.running ? "recording.running" : "recording.closed")}
        </p>
      </Row>
      <Row label={t("recording.profile")}>
        <p className="pt-1.5 text-sm">{t(installed ? "recording.profileInstalled" : "recording.profileMissing")}</p>
      </Row>

      {status.running && <Notice tone="warn">{t("recording.closeObs")}</Notice>}
      {platform === "linux" && !status.appAudioPlugin && (
        <Notice tone="warn">
          <p>{t("recording.pluginMissing")}</p>
          <p className="mt-1">
            {status.install.kind === "flatpak"
              ? cmd("recording.pluginFlatpak", "flatpak install flathub com.obsproject.Studio.Plugin.PipeWireAudioCapture")
              : t("recording.pluginNative")}{" "}
            <button type="button" className={linkClass} onClick={() => void openUrl(PLUGIN_PAGE)}>{t("recording.pluginPage")}</button>
          </p>
        </Notice>
      )}

      <fieldset disabled={locked} className="divide-y divide-neutral-200 dark:divide-neutral-800">
        <Row label={t("recording.buffer")} hint={t("recording.bufferHint")}>
          <div className="flex items-center gap-2 text-sm">
            <NumberInput value={form.bufferSec / 60} min={0.5} max={60} step={0.5} onChange={(v) => v !== null && set({ bufferSec: Math.round(v * 60) })} />
            {t("recording.minutes")}
          </div>
        </Row>

        <Row label={t("recording.replaysFolder")}>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800" title={form.replaysFolder}>
              {form.replaysFolder}
            </code>
            <Button onClick={() => void pickFolder()}>{t("settings.change")}</Button>
          </div>
        </Row>

        <Row label={t("recording.hotkey")} hint={t(`recording.hotkeyHint.${hotkeys}`)}>
          <HotkeyInput value={form.saveHotkey} onChange={(saveHotkey) => { set({ saveHotkey }); setConflicts([]); }} />
          {hotkeys === "manual" && <CopyCommand command={status.saveReplayCommand} />}
          {conflicts.length > 0 && (
            <Notice tone="warn">
              <p>{t("recording.hotkeyConflicts", { keys: formatHotkey(form.saveHotkey) })}</p>
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            </Notice>
          )}
        </Row>

        <Row label={t("recording.encoder")} hint={t("recording.encoderHint")}>
          {usable === undefined ? (
            <p className="pt-1.5 text-sm text-neutral-500">{t("recording.testingEncoders")}</p>
          ) : (
            <Select<RecordingEncoder | "auto">
              value={form.encoder}
              options={[
                ["auto", t("recording.encoderAuto", { name: t(`recording.encoderNames.${autoEncoder}`) })],
                ...offered.map((e): [RecordingEncoder, string] => [e, t(`recording.encoderNames.${e}`)]),
              ]}
              onChange={(encoder) => set({ encoder })}
            />
          )}
        </Row>

        {showBrowsers && (
          <Row label={t("recording.browsers")} hint={t("recording.browsersHint")}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
              {BROWSERS.map((b) => (
                <label key={b} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox" className="h-4 w-4" checked={form.browsers.includes(b)}
                    onChange={(e) => set({ browsers: e.target.checked ? BROWSERS.filter((x) => x === b || form.browsers.includes(x)) : form.browsers.filter((x) => x !== b) })}
                  />
                  {BROWSER_LABELS[b]}
                </label>
              ))}
            </div>
          </Row>
        )}

        <details className="py-1">
          <summary className="cursor-pointer py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300">{t("recording.advanced")}</summary>
          <Row label={t("recording.memory")} hint={t("recording.memoryHint", { mb: defaultMemoryMb(form.bufferSec) })}>
            <NumberInput value={form.memoryMb} min={100} max={65536} placeholder={String(defaultMemoryMb(form.bufferSec))} onChange={(memoryMb) => set({ memoryMb })} />
          </Row>
          <Row label={t("recording.resolution")}>
            <div className="flex items-center gap-2 text-sm">
              <NumberInput value={form.width} min={320} max={7680} step={2} onChange={(v) => v !== null && set({ width: v })} />
              ×
              <NumberInput value={form.height} min={240} max={4320} step={2} onChange={(v) => v !== null && set({ height: v })} />
            </div>
          </Row>
          <Row label={t("recording.fps")}>
            <NumberInput value={form.fps} min={1} max={240} onChange={(v) => v !== null && set({ fps: v })} />
          </Row>
          <Row label={t("recording.quality")} hint={t("recording.qualityHint")}>
            <NumberInput value={form.quality} min={1} max={51} onChange={(v) => v !== null && set({ quality: v })} />
          </Row>
        </details>
      </fieldset>

      <Row label={t("recording.startAtLogin")}>
        <label className="flex items-center gap-2 pt-1.5 text-sm">
          <input type="checkbox" className="h-4 w-4" disabled={busy} checked={autostart} onChange={(e) => toggleAutostart(e.target.checked)} />
          {t("recording.autostart")}
        </label>
      </Row>

      <div className="flex items-center gap-2 border-t border-neutral-200 py-3 dark:border-neutral-800">
        <Button variant="primary" disabled={locked} onClick={() => void install()}>
          {t(installed ? "recording.save" : "recording.install")}
        </Button>
        {installed && (
          <Button disabled={busy || status.running} onClick={() => void run(obsLaunch)}>{t("recording.openObs")}</Button>
        )}
        {installed && (
          <Button variant="ghost" className="ml-auto" disabled={locked} onClick={() => void remove()}>{t("recording.remove")}</Button>
        )}
      </div>
    </div>
  );
}
