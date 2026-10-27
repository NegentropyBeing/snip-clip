mod ffmpeg;
mod files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_locate,
            ffmpeg::exec_tool,
            ffmpeg::run_ffmpeg,
            ffmpeg::cancel_ffmpeg,
            files::file_size,
            files::path_exists,
            files::ensure_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
