mod clipboard;
mod ffmpeg;
mod files;
mod provision;
mod search;
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .manage(provision::DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_locate,
            ffmpeg::exec_tool,
            ffmpeg::run_ffmpeg,
            ffmpeg::cancel_ffmpeg,
            provision::ffmpeg_download_info,
            provision::ffmpeg_download,
            provision::ffmpeg_download_cancel,
            clipboard::copy_files,
            updates::list_releases,
            files::file_size,
            files::file_stat,
            files::path_exists,
            files::ensure_dir,
            files::read_text,
            files::write_text,
            files::allow_asset,
            files::prune_dirs,
            files::remove_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
