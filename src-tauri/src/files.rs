//! Small filesystem operations the editor and the export pipeline need.

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    size: u64,
    mtime_ms: f64,
}

#[tauri::command]
pub fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path).map(|m| m.len()).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn file_stat(path: String) -> Result<FileStat, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64);
    Ok(FileStat { size: meta.len(), mtime_ms })
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("{path}: {e}"))
}

/// Removes a file; a missing file is not an error (used for partial outputs of cancelled exports).
#[tauri::command]
pub fn remove_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{path}: {e}")),
        _ => Ok(()),
    }
}

/// Returns None when the file does not exist yet.
#[tauri::command]
pub fn read_text(path: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// Writes through a temporary file so a crash never leaves a half-written project.
#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{path}: {e}"))?;
    }
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, target).map_err(|e| format!("{path}: {e}"))
}

/// Lets the WebView stream a file the user opened (video element) through the asset protocol.
#[tauri::command]
pub fn allow_asset(app: AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())
}

/// Deletes all but the `keep` most recently modified subdirectories of `dir`, skipping `except`.
#[tauri::command]
pub fn prune_dirs(dir: String, keep: usize, except: Option<String>) -> Result<u32, String> {
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(0) };
    let mut dirs: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| except.as_deref() != Some(e.file_name().to_string_lossy().as_ref()))
        .map(|e| {
            let mtime = e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
            (mtime, e.path())
        })
        .collect();
    dirs.sort_by(|a, b| b.0.cmp(&a.0));
    let mut removed = 0;
    for (_, path) in dirs.into_iter().skip(keep) {
        if std::fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_and_prune() {
        let dir = std::env::temp_dir().join(format!("clip-snip-files-{}", std::process::id()));
        let file = dir.join("nested").join("p.json");
        let path = file.to_string_lossy().to_string();
        assert_eq!(read_text(path.clone()).unwrap(), None);
        write_text(path.clone(), "{\"a\":1}".into()).unwrap();
        assert_eq!(read_text(path.clone()).unwrap().as_deref(), Some("{\"a\":1}"));
        assert!(!file.with_extension("tmp").exists());

        let root = dir.join("cache");
        for name in ["a", "b", "c"] {
            std::fs::create_dir_all(root.join(name)).unwrap();
        }
        let root_s = root.to_string_lossy().to_string();
        assert_eq!(prune_dirs(root_s, 1, Some("a".into())).unwrap(), 1);
        assert!(root.join("a").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
