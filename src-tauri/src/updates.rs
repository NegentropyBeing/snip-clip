//! Lists the app's GitHub releases so the UI can tell about a newer version. Nothing is installed:
//! the user follows the link to download it.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const RELEASES_URL: &str = "https://api.github.com/repos/NegentropyBeing/snip-clip/releases?per_page=20";

#[derive(Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Release {
    tag_name: String,
    html_url: String,
    prerelease: bool,
    draft: bool,
}

#[tauri::command]
pub async fn list_releases() -> Result<Vec<Release>, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("snip-clip/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let releases: Vec<Release> = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(releases.into_iter().filter(|r| !r.draft).collect())
}
