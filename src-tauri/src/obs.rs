//! The replay profile in OBS (spec §16): finding OBS, telling if it runs, and reading and writing
//! its settings files.
//!
//! The frontend builds the files' contents (src/core/replayProfile.ts); this module owns the
//! paths, so it only ever touches the replay profile's own files, OBS's WebSocket settings and
//! the start-at-login entry. Writes are refused while OBS runs, because OBS rewrites its
//! settings when it quits (FR-38).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

const PROFILE_NAME: &str = "snip-clip Replay";
const COLLECTION_FILE: &str = "snip-clip_Replay.json";
/// Starts OBS in the replay profile with the replay buffer running.
const LAUNCH_ARGS: [&str; 6] =
    ["--profile", PROFILE_NAME, "--collection", PROFILE_NAME, "--startreplaybuffer", "--disable-shutdown-check"];
const FLATPAK_ID: &str = "com.obsproject.Studio";
#[cfg(target_os = "linux")]
const APP_AUDIO_PLUGIN: &str = "linux-pipewire-audio.so";
#[cfg(target_os = "linux")]
const APP_AUDIO_FLATPAK_ID: &str = "com.obsproject.Studio.Plugin.PipeWireAudioCapture";
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "snip-clip OBS replay";
/// Command-line flag that starts OBS in the replay profile (the Windows start-at-login entry).
pub const START_OBS_FLAG: &str = "--start-obs";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallKind {
    Native,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Flatpak,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsInstall {
    pub kind: InstallKind,
    /// obs64.exe or the `obs` binary; None for the Flatpak, run through `flatpak run`.
    pub executable: Option<PathBuf>,
    /// OBS's settings folder (the one with `basic/` and `plugin_config/`).
    pub config_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    /// "windows", "linux" or "macos" (the replay profile is not available on macOS yet).
    platform: &'static str,
    install: Option<ObsInstall>,
    running: bool,
    profile_installed: bool,
    autostart: bool,
    /// Linux: a Wayland session, where OBS only sees its hotkeys while focused.
    wayland: bool,
    /// Linux: the obs-pipewire-audio-capture plugin for per-app tracks.
    app_audio_plugin: bool,
    /// Linux: the first render node, for testing VAAPI encoders.
    vaapi_device: Option<String>,
    /// Linux: the desktop (XDG_CURRENT_DESKTOP), e.g. "GNOME" or "KDE".
    desktop: Option<String>,
    /// The command a desktop shortcut runs to save the replay (FR-45).
    save_replay_command: String,
}

/// The replay profile's three files, as built by `buildReplayProfile`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFiles {
    basic_ini: String,
    record_encoder: Option<String>,
    collection: Option<String>,
}

fn profile_dir(config: &Path) -> PathBuf {
    config.join("basic").join("profiles").join(PROFILE_NAME)
}

fn collection_path(config: &Path) -> PathBuf {
    config.join("basic").join("scenes").join(COLLECTION_FILE)
}

fn websocket_path(config: &Path) -> PathBuf {
    config.join("plugin_config").join("obs-websocket").join("config.json")
}

fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[cfg(windows)]
pub fn find_obs() -> Option<ObsInstall> {
    use winreg::RegKey;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    // The installer records its folder; fall back to the default one.
    let dir = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\OBS Studio")
        .and_then(|k| k.get_value::<String, _>(""))
        .map(PathBuf::from)
        .ok()
        .or_else(|| std::env::var_os("ProgramFiles").map(|pf| PathBuf::from(pf).join("obs-studio")))?;
    let exe = dir.join(r"bin\64bit\obs64.exe");
    let config_dir = PathBuf::from(std::env::var_os("APPDATA")?).join("obs-studio");
    exe.is_file().then_some(ObsInstall { kind: InstallKind::Native, executable: Some(exe), config_dir })
}

#[cfg(target_os = "linux")]
fn quiet_success(program: &str, args: &[&str]) -> bool {
    use std::process::Stdio;
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(target_os = "linux")]
fn xdg_config_home() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}

/// The native OBS wins over the Flatpak when both are installed.
#[cfg(target_os = "linux")]
pub fn find_obs() -> Option<ObsInstall> {
    if let Ok(exe) = which::which("obs") {
        return Some(ObsInstall { kind: InstallKind::Native, executable: Some(exe), config_dir: xdg_config_home()?.join("obs-studio") });
    }
    if quiet_success("flatpak", &["info", FLATPAK_ID]) {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        let config_dir = home.join(".var/app").join(FLATPAK_ID).join("config/obs-studio");
        return Some(ObsInstall { kind: InstallKind::Flatpak, executable: None, config_dir });
    }
    None
}

#[cfg(target_os = "macos")]
pub fn find_obs() -> Option<ObsInstall> {
    None
}

#[cfg(windows)]
fn is_running() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq obs64.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("\"obs64.exe\""))
}

/// The native and the Flatpak OBS both run a process named `obs`.
#[cfg(target_os = "linux")]
fn is_running() -> bool {
    let Ok(entries) = std::fs::read_dir("/proc") else { return false };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()))
        .any(|e| std::fs::read_to_string(e.path().join("comm")).is_ok_and(|c| c.trim_end() == "obs"))
}

#[cfg(target_os = "macos")]
fn is_running() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland") || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(not(target_os = "linux"))]
fn is_wayland() -> bool {
    false
}

/// Folders where a native OBS loads plugins from: the user's plugins folder, then the system ones.
#[cfg(target_os = "linux")]
fn plugin_dirs(config: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(config.join("plugins"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path().join("bin/64bit"))
        .collect();
    for root in ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/usr/local/lib64"] {
        dirs.push(Path::new(root).join("obs-plugins"));
        // Debian-style multiarch, e.g. /usr/lib/x86_64-linux-gnu/obs-plugins.
        dirs.extend(
            std::fs::read_dir(root).into_iter().flatten().filter_map(Result::ok).map(|e| e.path().join("obs-plugins")),
        );
    }
    dirs
}

#[cfg(target_os = "linux")]
fn has_app_audio_plugin(install: &ObsInstall) -> bool {
    match install.kind {
        InstallKind::Flatpak => quiet_success("flatpak", &["info", APP_AUDIO_FLATPAK_ID]),
        InstallKind::Native => plugin_dirs(&install.config_dir).iter().any(|d| d.join(APP_AUDIO_PLUGIN).is_file()),
    }
}

#[cfg(not(target_os = "linux"))]
fn has_app_audio_plugin(_: &ObsInstall) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn vaapi_device() -> Option<String> {
    let mut nodes: Vec<String> = std::fs::read_dir("/dev/dri")
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path().to_string_lossy().into_owned())
        .filter(|p| p.starts_with("/dev/dri/renderD"))
        .collect();
    nodes.sort();
    nodes.into_iter().next()
}

#[cfg(not(target_os = "linux"))]
fn vaapi_device() -> Option<String> {
    None
}

/// The OBS command line for the replay profile (also the Linux start-at-login entry).
fn launch_command(install: &ObsInstall) -> Command {
    let mut cmd = match &install.executable {
        Some(exe) => Command::new(exe),
        None => {
            let mut c = Command::new("flatpak");
            c.args(["run", FLATPAK_ID]);
            c
        }
    };
    cmd.args(LAUNCH_ARGS);
    // OBS on Windows finds its data relative to the working directory.
    if let Some(dir) = install.executable.as_deref().and_then(Path::parent) {
        cmd.current_dir(dir);
    }
    cmd
}

/// Starts OBS in the replay profile unless it already runs. OBS keeps running after snip-clip quits.
pub fn launch() -> Result<(), String> {
    let install = find_obs().ok_or("OBS not found")?;
    if is_running() {
        return Ok(());
    }
    launch_command(&install).spawn().map(drop).map_err(|e| format!("OBS: {e}"))
}

fn ensure_closed() -> Result<(), String> {
    if is_running() { Err("OBS is running; close it first".into()) } else { Ok(()) }
}

fn installed() -> Result<ObsInstall, String> {
    find_obs().ok_or_else(|| "OBS not found".into())
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    crate::files::read_text(path.to_string_lossy().into_owned())
}

fn write(path: &Path, contents: String) -> Result<(), String> {
    crate::files::write_text(path.to_string_lossy().into_owned(), contents)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Copies the current replay profile to `basic/backup-<stamp>/`; None when there is none yet.
fn backup(config: &Path, stamp: &str) -> Result<Option<PathBuf>, String> {
    let (profile, collection) = (profile_dir(config), collection_path(config));
    if !profile.is_dir() && !collection.is_file() {
        return Ok(None);
    }
    let dest = config.join("basic").join(format!("backup-{stamp}"));
    let err = |e: std::io::Error| format!("{}: {e}", dest.display());
    if profile.is_dir() {
        copy_dir(&profile, &dest.join(format!("profile-{PROFILE_NAME}"))).map_err(err)?;
    }
    if collection.is_file() {
        std::fs::create_dir_all(&dest).map_err(err)?;
        std::fs::copy(&collection, dest.join(COLLECTION_FILE)).map_err(err)?;
    }
    Ok(Some(dest))
}

fn read_profile_in(config: &Path) -> Result<Option<ProfileFiles>, String> {
    let Some(basic_ini) = read_optional(&profile_dir(config).join("basic.ini"))? else { return Ok(None) };
    Ok(Some(ProfileFiles {
        basic_ini,
        record_encoder: read_optional(&profile_dir(config).join("recordEncoder.json"))?,
        collection: read_optional(&collection_path(config))?,
    }))
}

fn install_profile_in(config: &Path, files: ProfileFiles, stamp: &str) -> Result<Option<PathBuf>, String> {
    let saved = backup(config, stamp)?;
    let dir = profile_dir(config);
    write(&dir.join("basic.ini"), files.basic_ini)?;
    write(&dir.join("recordEncoder.json"), files.record_encoder.unwrap_or_default())?;
    write(&collection_path(config), files.collection.unwrap_or_default())?;
    Ok(saved)
}

/// Deletes the profile and the scene collection; backups stay (FR-39).
fn remove_profile_in(config: &Path) -> Result<(), String> {
    let dir = profile_dir(config);
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("{}: {e}", dir.display())),
        _ => {}
    }
    crate::files::remove_file(collection_path(config).to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
fn autostart_file() -> Option<PathBuf> {
    Some(xdg_config_home()?.join("autostart").join("snip-clip-obs-replay.desktop"))
}

/// `Exec=` line of the Linux start-at-login entry, with the arguments quoted for desktop files.
#[cfg(any(target_os = "linux", test))]
fn desktop_entry(program: &[String]) -> String {
    let quote = |a: &str| {
        if a.chars().any(|c| c.is_whitespace() || "\"'\\$`".contains(c)) {
            format!("\"{}\"", a.replace('\\', "\\\\").replace('"', "\\\"").replace('$', "\\$").replace('`', "\\`"))
        } else {
            a.to_string()
        }
    };
    let exec: Vec<String> = program.iter().map(|a| quote(a)).chain(LAUNCH_ARGS.iter().map(|a| quote(a))).collect();
    format!("[Desktop Entry]\nType=Application\nName=OBS replay (snip-clip)\nExec={}\nX-GNOME-Autostart-enabled=true\n", exec.join(" "))
}

#[cfg(target_os = "linux")]
fn autostart_enabled() -> bool {
    autostart_file().is_some_and(|f| f.is_file())
}

#[cfg(target_os = "linux")]
fn set_autostart(enabled: bool) -> Result<(), String> {
    let file = autostart_file().ok_or("no config folder")?;
    if !enabled {
        return crate::files::remove_file(file.to_string_lossy().into_owned());
    }
    let install = installed()?;
    let program = match &install.executable {
        Some(exe) => vec![exe.to_string_lossy().into_owned()],
        None => vec!["flatpak".into(), "run".into(), FLATPAK_ID.into()],
    };
    write(&file, desktop_entry(&program))
}

#[cfg(windows)]
fn autostart_enabled() -> bool {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .is_ok_and(|k| k.get_value::<String, _>(RUN_VALUE).is_ok())
}

/// The Run entry starts snip-clip with `--start-obs`, which starts OBS in its own folder (a Run
/// entry cannot set the working directory) and finds OBS again after it moves or updates.
#[cfg(windows)]
fn set_autostart(enabled: bool) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY).map_err(|e| e.to_string())?;
    if !enabled {
        return match key.delete_value(RUN_VALUE) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    key.set_value(RUN_VALUE, &format!("\"{}\" {START_OBS_FLAG}", exe.display())).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn autostart_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn set_autostart(_: bool) -> Result<(), String> {
    Err("not available on macOS".into())
}

/// The installed snip-clip: an AppImage runs from a temporary mount, so use the image itself.
fn self_exe() -> PathBuf {
    std::env::var_os("APPIMAGE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from("snip-clip"))
}

/// Quotes for a POSIX shell (GNOME parses custom shortcut commands that way).
fn shell_quote(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+:".contains(c)) {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

fn save_replay_command() -> String {
    let exe = self_exe().to_string_lossy().into_owned();
    if cfg!(windows) {
        format!("\"{exe}\" {}", crate::replay_save::SAVE_REPLAY_FLAG)
    } else {
        format!("{} {}", shell_quote(&exe), crate::replay_save::SAVE_REPLAY_FLAG)
    }
}

/// OBS's WebSocket settings, for `--save-replay`.
pub fn read_websocket_config() -> Result<Option<String>, String> {
    read_optional(&websocket_path(&installed()?.config_dir))
}

#[cfg(any(target_os = "linux", test))]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod gnome {
    pub const SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
    pub const PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/snip-clip-save-replay/";
    /// Where GNOME keeps its own shortcuts, checked for clashes.
    pub const SHORTCUT_SCHEMAS: [&str; 5] = [
        "org.gnome.desktop.wm.keybindings",
        "org.gnome.shell.keybindings",
        "org.gnome.mutter.keybindings",
        "org.gnome.mutter.wayland.keybindings",
        "org.gnome.settings-daemon.plugins.media-keys",
    ];

    /// A GVariant string array as gsettings prints it: "['/a/', '/b/']" or "@as []".
    pub fn parse_list(text: &str) -> Vec<String> {
        text.trim()
            .trim_start_matches("@as")
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .split(',')
            .map(|s| s.trim().trim_matches('\'').to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    pub fn format_list(items: &[String]) -> String {
        format!("[{}]", items.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", "))
    }

    /// A GVariant string literal.
    pub fn string(value: &str) -> String {
        format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
    }

    /// GNOME writes Control as <Primary> or <Ctrl> too; compare without case.
    fn normalize(accel: &str) -> String {
        accel.replace("<Primary>", "<Control>").replace("<Ctrl>", "<Control>").to_lowercase()
    }

    /// "schema key" of every shortcut in `gsettings list-recursively` output bound to `accel`.
    pub fn conflicts(listing: &str, accel: &str) -> Vec<String> {
        let wanted = normalize(accel);
        listing
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(3, ' ');
                let (schema, key, value) = (parts.next()?, parts.next()?, parts.next()?);
                let bound = value.split('\'').skip(1).step_by(2).any(|a| normalize(a) == wanted);
                bound.then(|| format!("{schema} {key}"))
            })
            .collect()
    }
}

#[cfg(target_os = "linux")]
fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gsettings").args(args).output().map_err(|e| format!("gsettings: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!("gsettings: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Registers a GNOME custom shortcut that runs `snip-clip --save-replay` (FR-44). Returns the
/// GNOME shortcuts already bound to the same keys, which the user has to free.
#[cfg(target_os = "linux")]
fn register_gnome_shortcut(accel: &str, name: &str) -> Result<Vec<String>, String> {
    let mut list = gnome::parse_list(&gsettings(&["get", gnome::SCHEMA, "custom-keybindings"])?);
    if !list.iter().any(|p| p == gnome::PATH) {
        list.push(gnome::PATH.to_string());
        gsettings(&["set", gnome::SCHEMA, "custom-keybindings", &gnome::format_list(&list)])?;
    }
    let schema = format!("{}.custom-keybinding:{}", gnome::SCHEMA, gnome::PATH);
    gsettings(&["set", &schema, "name", &gnome::string(name)])?;
    gsettings(&["set", &schema, "command", &gnome::string(&save_replay_command())])?;
    gsettings(&["set", &schema, "binding", &gnome::string(accel)])?;
    let listing: Vec<String> =
        gnome::SHORTCUT_SCHEMAS.iter().filter_map(|s| gsettings(&["list-recursively", s]).ok()).collect();
    Ok(gnome::conflicts(&listing.join("\n"), accel))
}

#[cfg(target_os = "linux")]
fn unregister_gnome_shortcut() -> Result<(), String> {
    let Ok(current) = gsettings(&["get", gnome::SCHEMA, "custom-keybindings"]) else { return Ok(()) };
    let list: Vec<String> = gnome::parse_list(&current).into_iter().filter(|p| p != gnome::PATH).collect();
    gsettings(&["set", gnome::SCHEMA, "custom-keybindings", &gnome::format_list(&list)])?;
    let schema = format!("{}.custom-keybinding:{}", gnome::SCHEMA, gnome::PATH);
    for key in ["name", "command", "binding"] {
        let _ = gsettings(&["reset", &schema, key]);
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn register_gnome_shortcut(_: &str, _: &str) -> Result<Vec<String>, String> {
    Err("GNOME shortcuts are Linux only".into())
}

#[cfg(not(target_os = "linux"))]
fn unregister_gnome_shortcut() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn obs_status() -> ObsStatus {
    let install = find_obs();
    ObsStatus {
        platform: platform(),
        running: install.is_some() && is_running(),
        profile_installed: install.as_ref().is_some_and(|i| profile_dir(&i.config_dir).join("basic.ini").is_file()),
        autostart: autostart_enabled(),
        wayland: is_wayland(),
        app_audio_plugin: install.as_ref().is_some_and(has_app_audio_plugin),
        vaapi_device: vaapi_device(),
        desktop: std::env::var("XDG_CURRENT_DESKTOP").ok().filter(|d| !d.is_empty() && cfg!(target_os = "linux")),
        save_replay_command: save_replay_command(),
        install,
    }
}

#[tauri::command]
pub fn obs_read_profile() -> Result<Option<ProfileFiles>, String> {
    read_profile_in(&installed()?.config_dir)
}

/// Backs up the current profile, if any, and writes the new one. `stamp` names the backup
/// folder (e.g. 20261028-153000). Returns the backup folder.
#[tauri::command]
pub fn obs_install_profile(files: ProfileFiles, stamp: String) -> Result<Option<PathBuf>, String> {
    if stamp.is_empty() || !stamp.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err(format!("bad backup stamp: {stamp}"));
    }
    let install = installed()?;
    ensure_closed()?;
    install_profile_in(&install.config_dir, files, &stamp)
}

#[tauri::command]
pub fn obs_remove_profile() -> Result<(), String> {
    let install = installed()?;
    ensure_closed()?;
    remove_profile_in(&install.config_dir)
}

#[tauri::command]
pub fn obs_read_websocket() -> Result<Option<String>, String> {
    read_websocket_config()
}

#[tauri::command]
pub fn obs_write_websocket(contents: String) -> Result<(), String> {
    let install = installed()?;
    ensure_closed()?;
    write(&websocket_path(&install.config_dir), contents)
}

#[tauri::command]
pub fn obs_set_autostart(enabled: bool) -> Result<(), String> {
    set_autostart(enabled)
}

#[tauri::command]
pub fn obs_launch() -> Result<(), String> {
    launch()
}

/// `accel` in GNOME's format, e.g. "<Alt>F10"; `name` is shown in GNOME's keyboard settings.
#[tauri::command]
pub fn obs_register_gnome_shortcut(accel: String, name: String) -> Result<Vec<String>, String> {
    register_gnome_shortcut(&accel, &name)
}

#[tauri::command]
pub fn obs_unregister_gnome_shortcut() -> Result<(), String> {
    unregister_gnome_shortcut()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("snip-clip-obs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn files(tag: &str) -> ProfileFiles {
        ProfileFiles {
            basic_ini: format!("[General]\nName={tag}\n"),
            record_encoder: Some(format!("{{\"tag\":\"{tag}\"}}")),
            collection: Some(format!("{{\"name\":\"{tag}\"}}")),
        }
    }

    #[test]
    fn installs_backs_up_reads_and_removes() {
        let config = temp_config("install");
        assert!(read_profile_in(&config).unwrap().is_none());
        assert_eq!(install_profile_in(&config, files("one"), "20261028-150000").unwrap(), None);

        let backup = install_profile_in(&config, files("two"), "20261028-150100").unwrap().unwrap();
        assert_eq!(backup, config.join("basic/backup-20261028-150100"));
        let old_ini = std::fs::read_to_string(backup.join("profile-snip-clip Replay/basic.ini")).unwrap();
        assert!(old_ini.contains("Name=one"));
        assert!(backup.join(COLLECTION_FILE).is_file());

        let read = read_profile_in(&config).unwrap().unwrap();
        assert!(read.basic_ini.contains("Name=two"));
        assert_eq!(read.collection.as_deref(), Some("{\"name\":\"two\"}"));
        assert!(config.join("basic/scenes/snip-clip_Replay.json").is_file());

        remove_profile_in(&config).unwrap();
        assert!(read_profile_in(&config).unwrap().is_none());
        assert!(!collection_path(&config).exists());
        assert!(backup.is_dir(), "backups stay");
        remove_profile_in(&config).unwrap();
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn reads_a_profile_with_missing_files() {
        let config = temp_config("partial");
        write(&profile_dir(&config).join("basic.ini"), "[General]\n".into()).unwrap();
        let read = read_profile_in(&config).unwrap().unwrap();
        assert!(read.record_encoder.is_none() && read.collection.is_none());
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn quotes_the_desktop_entry() {
        let entry = desktop_entry(&["/opt/my apps/obs".into()]);
        assert!(entry.contains(
            "Exec=\"/opt/my apps/obs\" --profile \"snip-clip Replay\" --collection \"snip-clip Replay\" --startreplaybuffer --disable-shutdown-check\n"
        ));
        let flatpak = desktop_entry(&["flatpak".into(), "run".into(), "com.obsproject.Studio".into()]);
        assert!(flatpak.contains("Exec=flatpak run com.obsproject.Studio --profile"));
    }

    /// Prints what this machine reports: `cargo test real_obs_status -- --ignored --nocapture`.
    #[test]
    #[ignore = "depends on the OBS installed here"]
    fn real_obs_status() {
        println!("{}", serde_json::to_string_pretty(&obs_status()).unwrap());
    }

    #[test]
    fn reads_and_writes_gnome_lists() {
        assert!(gnome::parse_list("@as []").is_empty());
        let list = gnome::parse_list("['/a/custom0/', '/a/custom1/']");
        assert_eq!(list, ["/a/custom0/", "/a/custom1/"]);
        assert_eq!(gnome::format_list(&list), "['/a/custom0/', '/a/custom1/']");
        assert_eq!(gnome::string(r"it's C:\x"), r"'it\'s C:\\x'");
    }

    #[test]
    fn finds_gnome_shortcuts_on_the_same_keys() {
        let listing = "org.gnome.desktop.wm.keybindings toggle-maximized ['<Alt>F10']\n\
                       org.gnome.desktop.wm.keybindings close ['<Alt>F4']\n\
                       org.gnome.shell.keybindings screenshot ['<Shift>Print', '<Primary><Shift>s']\n\
                       org.gnome.desktop.wm.keybindings minimize @as []";
        assert_eq!(gnome::conflicts(listing, "<Alt>F10"), ["org.gnome.desktop.wm.keybindings toggle-maximized"]);
        assert_eq!(gnome::conflicts(listing, "<Control><Shift>S"), ["org.gnome.shell.keybindings screenshot"]);
        assert!(gnome::conflicts(listing, "<Alt>F9").is_empty());
    }

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(shell_quote("/usr/bin/snip-clip"), "/usr/bin/snip-clip");
        assert_eq!(shell_quote("/opt/My Apps/snip-clip"), "'/opt/My Apps/snip-clip'");
        assert_eq!(shell_quote("/x/it's"), r"'/x/it'\''s'");
    }

    #[test]
    fn launches_from_the_obs_folder() {
        let install = ObsInstall {
            kind: InstallKind::Native,
            executable: Some(PathBuf::from("/opt/obs/bin/obs")),
            config_dir: PathBuf::new(),
        };
        let cmd = launch_command(&install);
        assert_eq!(cmd.get_current_dir(), Some(Path::new("/opt/obs/bin")));
        assert_eq!(cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>(), LAUNCH_ARGS);
    }
}
