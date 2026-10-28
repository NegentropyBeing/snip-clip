//! Downloading a pinned FFmpeg build into the app data folder (FR-30, FR-31).
//!
//! Each platform has fixed archive URLs with their size and SHA-256; nothing "latest" is ever
//! fetched. Only ffmpeg and ffprobe are kept from the archives.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::ffmpeg::{FfmpegInfo, FfmpegState, Tool, app_bin_dir, locate};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Zip,
    TarXz,
}

struct Archive {
    url: &'static str,
    size: u64,
    sha256: &'static str,
    format: Format,
}

struct Build {
    version: &'static str,
    /// Where the build comes from, shown on the download screen.
    origin: &'static str,
    archives: &'static [Archive],
}

// Windows / Linux: BtbN month-end autobuild (kept long-term), release branch 9.0, GPL, static.
macro_rules! btbn {
    ($file:literal) => {
        concat!("https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/", $file)
    };
}
// macOS: Martin Riedl's static release builds (ffmpeg and ffprobe ship as separate zips).
macro_rules! riedl {
    ($file:literal) => {
        concat!("https://ffmpeg.martin-riedl.de/download/macos/", $file)
    };
}

fn build() -> Option<Build> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let archives: &'static [Archive] = match (os, arch) {
        ("windows", "x86_64") => &[Archive {
            url: btbn!("ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-9.0.zip"),
            size: 194_034_585,
            sha256: "a0e45723c72141975f51d8666302e614711745f3102b704ca3f82c897a58d278",
            format: Format::Zip,
        }],
        ("windows", "aarch64") => &[Archive {
            url: btbn!("ffmpeg-n9.0.2-17-g2a571b6068-winarm64-gpl-9.0.zip"),
            size: 135_510_041,
            sha256: "6dcd0626f9f6d6c7323565e57410e9f37ed14a85946ec9ea9caff294ca32f5c0",
            format: Format::Zip,
        }],
        ("linux", "x86_64") => &[Archive {
            url: btbn!("ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz"),
            size: 151_017_172,
            sha256: "68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269",
            format: Format::TarXz,
        }],
        ("linux", "aarch64") => &[Archive {
            url: btbn!("ffmpeg-n9.0.2-17-g2a571b6068-linuxarm64-gpl-9.0.tar.xz"),
            size: 127_445_692,
            sha256: "91afcd7695d4bbbb9e0057aa10baaf9875ec4e1a97303f9059ec971336a2ab46",
            format: Format::TarXz,
        }],
        ("macos", "x86_64") => &[
            Archive {
                url: riedl!("amd64/1789931006_9.0.2/ffmpeg.zip"),
                size: 33_816_391,
                sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
                format: Format::Zip,
            },
            Archive {
                url: riedl!("amd64/1789931006_9.0.2/ffprobe.zip"),
                size: 33_719_233,
                sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
                format: Format::Zip,
            },
        ],
        ("macos", "aarch64") => &[
            Archive {
                url: riedl!("arm64/1789931890_9.0.2/ffmpeg.zip"),
                size: 28_395_699,
                sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
                format: Format::Zip,
            },
            Archive {
                url: riedl!("arm64/1789931890_9.0.2/ffprobe.zip"),
                size: 28_317_701,
                sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
                format: Format::Zip,
            },
        ],
        _ => return None,
    };
    let origin = if os == "macos" { "ffmpeg.martin-riedl.de" } else { "github.com/BtbN/FFmpeg-Builds" };
    Some(Build { version: "9.0.2", origin, archives })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    version: &'static str,
    origin: &'static str,
    /// Total download size in bytes.
    bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    stage: &'static str,
    received: u64,
    total: u64,
}

#[derive(Default)]
pub struct DownloadState {
    running: AtomicBool,
    cancel: AtomicBool,
}

/// What would be downloaded on this platform; None when there is no pinned build for it.
#[tauri::command]
pub fn ffmpeg_download_info() -> Option<DownloadInfo> {
    build().map(|b| DownloadInfo { version: b.version, origin: b.origin, bytes: b.archives.iter().map(|a| a.size).sum() })
}

#[tauri::command]
pub fn ffmpeg_download_cancel(state: State<'_, DownloadState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Downloads, verifies and installs the pinned build, then makes it the active FFmpeg.
/// Progress is emitted as `ffmpeg-download` events. Fails with "cancelled" when cancelled.
#[tauri::command]
pub async fn ffmpeg_download(app: AppHandle, state: State<'_, DownloadState>, ffmpeg: State<'_, FfmpegState>) -> Result<FfmpegInfo, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("a download is already running".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let dir = app_bin_dir(&app).ok_or("no app data folder")?;
    let result = install(&app, &dir, &state.cancel).await;
    let _ = std::fs::remove_dir_all(dir.join(".download"));
    state.running.store(false, Ordering::SeqCst);
    result?;
    let info = locate(&app).await.filter(|i| i.source == "app").ok_or("the downloaded FFmpeg does not run on this computer")?;
    ffmpeg.set(Some(info.clone()));
    Ok(info)
}

async fn install(app: &AppHandle, dir: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let build = build().ok_or("no FFmpeg download for this platform")?;
    let tmp = dir.join(".download");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let total: u64 = build.archives.iter().map(|a| a.size).sum();
    let emit = |stage, received| {
        let _ = app.emit("ffmpeg-download", DownloadProgress { stage, received, total });
    };

    let client = reqwest::Client::builder()
        .user_agent(concat!("snip-clip/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut done = 0;
    let mut files = Vec::new();
    for (i, archive) in build.archives.iter().enumerate() {
        let path = tmp.join(format!("{i}.archive"));
        download(&client, archive, &path, cancel, |n| emit("download", done + n)).await?;
        done += archive.size;
        files.push((path, archive.format));
    }

    emit("extract", total);
    let staging = tmp.join("staging");
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let staging_ = staging.clone();
    tokio::task::spawn_blocking(move || files.iter().try_for_each(|(path, format)| extract(path, *format, &staging_)))
        .await
        .map_err(|e| e.to_string())??;

    for tool in [Tool::Ffmpeg, Tool::Ffprobe] {
        let from = staging.join(tool.file_name());
        if !from.is_file() {
            return Err(format!("{} missing from the archive", tool.file_name()));
        }
        make_executable(&from)?;
        let to = dir.join(tool.file_name());
        let _ = std::fs::remove_file(&to);
        std::fs::rename(&from, &to).map_err(|e| format!("{}: {e}", to.display()))?;
    }
    Ok(())
}

/// Streams `archive` to `path`, checking size and SHA-256 on the way.
async fn download(client: &reqwest::Client, archive: &Archive, path: &Path, cancel: &AtomicBool, progress: impl Fn(u64)) -> Result<(), String> {
    let res = client.get(archive.url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download failed: {e}"))?;
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last = Instant::now();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| format!("download failed: {e}"))?;
        received += chunk.len() as u64;
        if received > archive.size {
            return Err("download is larger than expected".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        if last.elapsed() >= Duration::from_millis(150) {
            progress(received);
            last = Instant::now();
        }
    }
    progress(received);
    let digest = hex(&hasher.finalize());
    if received != archive.size || digest != archive.sha256 {
        return Err(format!("checksum mismatch for {} (got {digest}, {received} bytes)", archive.url));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Extracts the ffmpeg and ffprobe binaries (wherever they sit in the archive) into `out`.
fn extract(path: &Path, format: Format, out: &Path) -> Result<(), String> {
    let names = [Tool::Ffmpeg.file_name(), Tool::Ffprobe.file_name()];
    match format {
        Format::Zip => {
            let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                if !entry.is_file() {
                    continue;
                }
                let Some(path) = entry.enclosed_name() else { continue };
                let Some(name) = path.file_name().and_then(|n| n.to_str()).filter(|n| names.contains(n)) else {
                    continue;
                };
                let mut dest = std::fs::File::create(out.join(name)).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut dest).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        // BtbN's Linux archives (<name>/bin/ffmpeg); GNU tar and xz are on every desktop Linux.
        Format::TarXz => {
            let status = std::process::Command::new("tar")
                .arg("-xJf")
                .arg(path)
                .arg("-C")
                .arg(out)
                .args(["--wildcards", "--strip-components=2"])
                .args(names.iter().map(|n| format!("*/bin/{n}")))
                .status()
                .map_err(|e| format!("tar: {e}"))?;
            if status.success() { Ok(()) } else { Err(format!("tar exited with {status}")) }
        }
    }
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_build_is_well_formed() {
        let build = build().expect("a pinned build for the test platform");
        for a in build.archives {
            assert!(a.url.starts_with("https://"));
            assert_eq!(a.sha256.len(), 64);
            assert!(a.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
            assert!(a.size > 10_000_000);
        }
    }

    #[test]
    fn extracts_binaries_from_nested_zip() {
        let dir = std::env::temp_dir().join(format!("snip-clip-provision-{}", std::process::id()));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let zip_path = dir.join("a.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            for (name, body) in [
                (format!("ffmpeg-x/bin/{}", Tool::Ffmpeg.file_name()), "ff"),
                (format!("ffmpeg-x/bin/{}", Tool::Ffprobe.file_name()), "fp"),
                ("ffmpeg-x/bin/ffplay".to_string(), "no"),
                ("ffmpeg-x/doc/ffmpeg.html".to_string(), "no"),
            ] {
                w.start_file(name, opts).unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        extract(&zip_path, Format::Zip, &out).unwrap();
        assert_eq!(std::fs::read_to_string(out.join(Tool::Ffmpeg.file_name())).unwrap(), "ff");
        assert_eq!(std::fs::read_to_string(out.join(Tool::Ffprobe.file_name())).unwrap(), "fp");
        assert_eq!(std::fs::read_dir(&out).unwrap().count(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Downloads the real pinned build for this platform (~30–200 MB). Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn downloads_and_verifies_pinned_build() {
        let build = build().unwrap();
        let dir = std::env::temp_dir().join(format!("snip-clip-download-{}", std::process::id()));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let client = reqwest::Client::builder().user_agent("snip-clip-test").build().unwrap();
        for (i, a) in build.archives.iter().enumerate() {
            let path = dir.join(format!("{i}.archive"));
            download(&client, a, &path, &AtomicBool::new(false), |_| {}).await.unwrap();
            extract(&path, a.format, &out).unwrap();
        }
        let out_ffmpeg = out.join(Tool::Ffmpeg.file_name());
        let version = std::process::Command::new(&out_ffmpeg).arg("-version").output().unwrap();
        assert!(String::from_utf8_lossy(&version.stdout).lines().next().unwrap().contains(build.version));
        assert!(out.join(Tool::Ffprobe.file_name()).is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
