//! Where to look for a system FFmpeg besides the PATH the app inherited.
//!
//! An app started before FFmpeg was installed (or by an Explorer/Finder that never saw the new
//! PATH) inherits a stale PATH, and GUI apps on macOS get a minimal one. So after the inherited
//! PATH we also try the PATH currently saved in the registry (Windows) and the usual install
//! locations of the package managers we recommend.

use std::path::PathBuf;

/// Directories to search, in order, after the inherited PATH.
pub fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        dirs.extend(registry_path());
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            // winget portable packages: shims in Links, files under Packages\<id>_<source>\<version>\bin.
            dirs.push(local.join(r"Microsoft\WinGet\Links"));
            dirs.extend(winget_package_bins(&local.join(r"Microsoft\WinGet\Packages")));
        }
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            dirs.push(home.join(r"scoop\shims"));
        }
        if let Some(data) = std::env::var_os("ProgramData").map(PathBuf::from) {
            dirs.push(data.join(r"chocolatey\bin"));
        }
        dirs.push(PathBuf::from(r"C:\ffmpeg\bin"));
        if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            dirs.push(pf.join(r"ffmpeg\bin"));
        }
    }
    #[cfg(not(windows))]
    {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"] {
            dirs.push(PathBuf::from(d));
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            dirs.push(home.join(".local/bin"));
        }
    }
    dirs
}

#[cfg(windows)]
fn winget_package_bins(packages: &std::path::Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(packages) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().to_lowercase().contains("ffmpeg"))
        .filter_map(|e| std::fs::read_dir(e.path()).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path().join("bin"))
        .filter(|p| p.is_dir())
        .collect()
}

/// User PATH then machine PATH, as currently saved (not as inherited at startup).
#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let keys = [
        (HKEY_CURRENT_USER, "Environment"),
        (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    ];
    keys.iter()
        .filter_map(|(root, sub)| RegKey::predef(*root).open_subkey(sub).ok())
        .filter_map(|k| k.get_value::<String, _>("Path").ok())
        .flat_map(|p| std::env::split_paths(&expand_env(&p, |v| std::env::var(v).ok())).collect::<Vec<_>>())
        .collect()
}

/// Expands Windows-style `%VAR%` references; unknown variables are left as they are.
pub fn expand_env(text: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match lookup(name) {
                    Some(value) if !name.is_empty() => out.push_str(&value),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_known_variables_only() {
        let lookup = |v: &str| (v == "LOCALAPPDATA").then(|| r"C:\Users\a\AppData\Local".to_string());
        assert_eq!(
            expand_env(r"%LOCALAPPDATA%\Microsoft\WinGet\Links;%NOPE%\bin;100%", lookup),
            r"C:\Users\a\AppData\Local\Microsoft\WinGet\Links;%NOPE%\bin;100%"
        );
    }

    #[test]
    fn has_candidates() {
        assert!(!extra_dirs().is_empty());
    }
}
