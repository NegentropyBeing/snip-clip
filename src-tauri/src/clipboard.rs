//! Copies exported files (not their paths) to the clipboard, so Ctrl/Cmd+V in Discord uploads them (FR-21).
//!
//! Windows: CF_HDROP, as Explorer does. macOS: file URLs on the general pasteboard via AppleScriptObjC.
//! Linux: `text/uri-list` through wl-copy (Wayland) or xclip (X11); when neither is installed the UI
//! falls back to "Show in folder".

#[tauri::command]
pub async fn copy_files(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    for p in &paths {
        if !std::path::Path::new(p).is_file() {
            return Err(format!("{p}: not found"));
        }
    }
    tokio::task::spawn_blocking(move || copy(&paths)).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn copy(paths: &[String]) -> Result<(), String> {
    let _open = clipboard_win::Clipboard::new_attempts(10).map_err(|e| format!("clipboard: {e}"))?;
    // Clear first: leftover text on the clipboard would be pasted instead of the files.
    clipboard_win::raw::set_file_list_with(paths, clipboard_win::options::DoClear).map_err(|e| format!("clipboard: {e}"))
}

#[cfg(target_os = "macos")]
fn copy(paths: &[String]) -> Result<(), String> {
    const SCRIPT: &str = r#"use framework "AppKit"
on run argv
    set urls to current application's NSMutableArray's new()
    repeat with p in argv
        urls's addObject:(current application's NSURL's fileURLWithPath:(p as text))
    end repeat
    set pb to current application's NSPasteboard's generalPasteboard()
    pb's clearContents()
    pb's writeObjects:urls
end run"#;
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(SCRIPT)
        .args(paths)
        .output()
        .map_err(|e| format!("osascript: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("osascript: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn copy(paths: &[String]) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let list = uri_list(paths);
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let candidates: &[(&str, &[&str])] = if wayland {
        &[("wl-copy", &["--type", "text/uri-list"]), ("xclip", &["-selection", "clipboard", "-t", "text/uri-list"])]
    } else {
        &[("xclip", &["-selection", "clipboard", "-t", "text/uri-list"]), ("wl-copy", &["--type", "text/uri-list"])]
    };
    for (program, args) in candidates {
        // Both tools fork a process that keeps serving the clipboard; the parent exits once it has the data.
        let Ok(mut child) = Command::new(program).args(*args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else {
            continue;
        };
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(list.as_bytes()).map_err(|e| format!("{program}: {e}"))?;
        }
        return match child.wait() {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("{program} exited with {s}")),
            Err(e) => Err(format!("{program}: {e}")),
        };
    }
    Err("no clipboard tool found (install wl-clipboard or xclip)".into())
}

/// `text/uri-list` body: one percent-encoded `file://` URI per line, CRLF-terminated (RFC 2483).
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn uri_list(paths: &[String]) -> String {
    paths.iter().map(|p| format!("{}\r\n", file_uri(p))).collect()
}

#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn file_uri(path: &str) -> String {
    let mut uri = String::from("file://");
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) {
            uri.push(b as char);
        } else {
            uri.push_str(&format!("%{b:02X}"));
        }
    }
    uri
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_file_uris() {
        assert_eq!(file_uri("/home/a/Videos/Clips/Replay 2026 - ação.mp4"), "file:///home/a/Videos/Clips/Replay%202026%20-%20a%C3%A7%C3%A3o.mp4");
        assert_eq!(uri_list(&["/a".into(), "/b#1".into()]), "file:///a\r\nfile:///b%231\r\n");
    }
}
