import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { openSettings, useApp } from "../editor/app";
import { enqueueExport } from "../editor/exportQueue";
import { playback } from "../editor/playback";
import { editor, useEditor } from "../editor/store";
import { Kbd } from "./common";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
    && !(el instanceof HTMLInputElement && ["checkbox", "range", "radio"].includes(el.type)));

/** Editor keyboard shortcuts (spec 5.4). `onOpen` handles Ctrl/Cmd+O; Ctrl/Cmd+, opens the settings. */
export function useShortcuts(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        return openSettings();
      }
      if (useApp.getState().settingsOpen) return;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        return onOpen();
      }
      if (isTyping(e.target) || !useEditor.getState().media) return;
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const s = useEditor.getState();
        if (s.markIn !== null || s.markOut !== null) editor.confirmMarks();
        enqueueExport();
        return;
      }
      if (mod || e.altKey) return;
      const { time, selectedId, media } = useEditor.getState();
      let handled = true;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          playback.toggle();
          break;
        case "j":
        case "J":
          playback.jogBackward();
          break;
        case "l":
        case "L":
          playback.jogForward();
          break;
        case "ArrowLeft":
          if (e.shiftKey) playback.nudge(-1);
          else playback.step(-1);
          break;
        case "ArrowRight":
          if (e.shiftKey) playback.nudge(1);
          else playback.step(1);
          break;
        case "Home":
          playback.seek(0);
          break;
        case "End":
          playback.seek(media!.durationSec);
          break;
        case "i":
        case "I":
          editor.markIn(time);
          break;
        case "o":
        case "O":
          editor.markOut(time);
          break;
        case "Enter":
          editor.confirmMarks();
          break;
        case "Escape":
          editor.clearMarks();
          break;
        case "Delete":
        case "Backspace":
          if (selectedId) editor.removeCut(selectedId);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

export function ShortcutBar() {
  const { t } = useTranslation();
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const items: [string[], string][] = [
    [["Space", "K"], t("shortcuts.playPause")],
    [["J", "L"], t("shortcuts.jog")],
    [["←", "→"], t("shortcuts.frame")],
    [["Shift+←/→"], t("shortcuts.second")],
    [["I", "O"], t("shortcuts.marks")],
    [["Enter"], t("shortcuts.confirm")],
    [["Delete"], t("shortcuts.delete")],
    [[isMac ? "⌘E" : "Ctrl+E"], t("shortcuts.export")],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
      {items.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1">
          {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}
