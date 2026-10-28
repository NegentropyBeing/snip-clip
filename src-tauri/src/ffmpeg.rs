//! Locating and running FFmpeg/ffprobe.
//!
//! The frontend builds the argument lists (src/core); this module only resolves the binaries,
//! runs them, streams `-progress` updates as events and supports cancellation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    fn file_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ffmpeg, true) => "ffmpeg.exe",
            (Tool::Ffmpeg, false) => "ffmpeg",
            (Tool::Ffprobe, true) => "ffprobe.exe",
            (Tool::Ffprobe, false) => "ffprobe",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub version: String,
    /// "app" = downloaded into the app data dir, "system" = found on PATH.
    pub source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    out_time_sec: f64,
    done: bool,
}

/// Resolved binaries and the cancel handles of running jobs.
#[derive(Default)]
pub struct FfmpegState {
    info: Mutex<Option<FfmpegInfo>>,
    jobs: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

/// Directory where a downloaded FFmpeg lives (see FR-31).
pub fn app_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("ffmpeg"))
}

fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// First line of `ffmpeg -version`, e.g. "ffmpeg version 7.1 Copyright ..." -> "7.1".
pub fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().next()?;
    let rest = line.strip_prefix("ffmpeg version ")?;
    rest.split_whitespace().next().map(str::to_owned)
}

async fn version_of(ffmpeg: &Path) -> Option<String> {
    let out = command(ffmpeg).arg("-version").output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

async fn try_pair(ffmpeg: PathBuf, ffprobe: PathBuf, source: &'static str) -> Option<FfmpegInfo> {
    if !ffprobe.is_file() {
        return None;
    }
    let version = version_of(&ffmpeg).await?;
    Some(FfmpegInfo { ffmpeg, ffprobe, version, source })
}

/// Prefers the app-managed copy, then FFmpeg on PATH (FR-29).
pub async fn locate(app: &AppHandle) -> Option<FfmpegInfo> {
    if let Some(dir) = app_bin_dir(app) {
        let pair = (dir.join(Tool::Ffmpeg.file_name()), dir.join(Tool::Ffprobe.file_name()));
        if pair.0.is_file() {
            if let Some(info) = try_pair(pair.0, pair.1, "app").await {
                return Some(info);
            }
        }
    }
    if let (Ok(ffmpeg), Ok(ffprobe)) = (which::which("ffmpeg"), which::which("ffprobe")) {
        if let Some(info) = try_pair(ffmpeg, ffprobe, "system").await {
            return Some(info);
        }
    }
    // Not on the inherited PATH: try the current saved PATH and common install folders.
    for dir in crate::search::extra_dirs() {
        let pair = (dir.join(Tool::Ffmpeg.file_name()), dir.join(Tool::Ffprobe.file_name()));
        if pair.0.is_file() {
            if let Some(info) = try_pair(pair.0, pair.1, "system").await {
                return Some(info);
            }
        }
    }
    None
}

fn resolved(state: &FfmpegState, tool: Tool) -> Result<PathBuf, String> {
    let info = state.info.lock().unwrap();
    let info = info.as_ref().ok_or("FFmpeg not available")?;
    Ok(match tool {
        Tool::Ffmpeg => info.ffmpeg.clone(),
        Tool::Ffprobe => info.ffprobe.clone(),
    })
}

/// Parses one `-progress` line; returns the output position in seconds.
/// `out_time_us` and the misnamed `out_time_ms` are both microseconds.
pub fn parse_progress(line: &str) -> Option<f64> {
    let (key, value) = line.trim().split_once('=')?;
    match key {
        "out_time_us" | "out_time_ms" => value.parse::<i64>().ok().filter(|v| *v >= 0).map(|us| us as f64 / 1e6),
        _ => None,
    }
}

/// Keeps the last `max` lines, enough to explain a failure without holding the whole log.
fn tail(text: &str, max: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(max)..].join("\n")
}

#[tauri::command]
pub async fn ffmpeg_locate(app: AppHandle, state: State<'_, FfmpegState>) -> Result<Option<FfmpegInfo>, String> {
    let info = locate(&app).await;
    *state.info.lock().unwrap() = info.clone();
    Ok(info)
}

/// Runs a short FFmpeg/ffprobe command and returns its whole output (probes, encoder tests).
#[tauri::command]
pub async fn exec_tool(state: State<'_, FfmpegState>, tool: Tool, args: Vec<String>) -> Result<ExecOutput, String> {
    let path = resolved(&state, tool)?;
    let out = command(&path).args(&args).output().await.map_err(|e| e.to_string())?;
    Ok(ExecOutput {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Runs a long FFmpeg job. Args must include `-progress pipe:1`; position updates are emitted
/// as `ffmpeg-progress` events. Fails with the stderr tail, or "cancelled".
#[tauri::command]
pub async fn run_ffmpeg(app: AppHandle, state: State<'_, FfmpegState>, job_id: String, args: Vec<String>) -> Result<(), String> {
    let path = resolved(&state, Tool::Ffmpeg)?;
    let mut child = command(&path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    state.jobs.lock().unwrap().insert(job_id.clone(), cancel_tx);

    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let progress_app = app.clone();
    let progress_id = job_id.clone();
    let progress = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(sec) = parse_progress(&line) {
                let _ = progress_app.emit("ffmpeg-progress", ProgressEvent { job_id: &progress_id, out_time_sec: sec, done: false });
            }
        }
    });
    let errors = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let status = tokio::select! {
        status = child.wait() => Some(status.map_err(|e| e.to_string())?),
        _ = &mut cancel_rx => {
            let _ = child.kill().await;
            None
        }
    };
    state.jobs.lock().unwrap().remove(&job_id);
    let _ = progress.await;
    let stderr = errors.await.unwrap_or_default();

    match status {
        None => Err("cancelled".into()),
        Some(s) if s.success() => {
            let _ = app.emit("ffmpeg-progress", ProgressEvent { job_id: &job_id, out_time_sec: -1.0, done: true });
            Ok(())
        }
        Some(s) => Err(format!("ffmpeg exited with {}:\n{}", s.code().map_or("signal".into(), |c| c.to_string()), tail(&stderr, 30))),
    }
}

#[tauri::command]
pub fn cancel_ffmpeg(state: State<'_, FfmpegState>, job_id: String) -> bool {
    match state.jobs.lock().unwrap().remove(&job_id) {
        Some(tx) => tx.send(()).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_line() {
        assert_eq!(parse_version("ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2026\n"), Some("9.0.1-full_build-www.gyan.dev".into()));
        assert_eq!(parse_version("ffmpeg version n7.1-xyz Copyright"), Some("n7.1-xyz".into()));
        assert_eq!(parse_version("something else"), None);
    }

    #[test]
    fn parses_progress_lines() {
        assert_eq!(parse_progress("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress("out_time_ms=2000000\r\n"), Some(2.0));
        assert_eq!(parse_progress("out_time_us=-9223372036854775807"), None);
        assert_eq!(parse_progress("out_time_us=N/A"), None);
        assert_eq!(parse_progress("progress=continue"), None);
        assert_eq!(parse_progress("frame=10"), None);
    }

    #[test]
    fn tails_long_output() {
        let text = (1..=50).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        let t = tail(&text, 3);
        assert_eq!(t, "48\n49\n50");
        assert_eq!(tail("a\nb", 10), "a\nb");
    }
}
