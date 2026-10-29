mod commands;
mod db;
mod sources;
mod matching;
mod cover_letter;
mod scheduler;
mod mcp;
mod filtering;

use std::sync::Mutex;
use db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(database),
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_all_settings,
            // Resume
            commands::resume::upload_resume,
            commands::resume::get_resume,
            commands::resume::reparse_resume,
            commands::resume::update_resume_parsed,
            commands::resume::delete_resume,
            // Jobs
            commands::jobs::scan_jobs,
            commands::jobs::get_jobs,
            commands::jobs::get_job,
            commands::jobs::linkedin_login,
            commands::jobs::linkedin_login_status,
            commands::jobs::linkedin_logout,
            commands::jobs::scraper_login,
            commands::jobs::scraper_login_status,
            commands::jobs::scraper_logout,
            // Applications
            commands::applications::create_application,
            commands::applications::get_applications,
            commands::applications::update_application,
            commands::applications::delete_application,
            commands::applications::get_application_stats,
            // Cover Letters
            commands::cover_letters::generate_cover_letter,
            commands::cover_letters::get_cover_letters,
            commands::cover_letters::get_cover_letter,
            commands::cover_letters::update_cover_letter,
            commands::cover_letters::delete_cover_letter,
            // Matching
            commands::matching::score_all_jobs,
            commands::matching::rescore_all_jobs,
            // Scheduler
            commands::scheduler::start_scheduler,
            commands::scheduler::stop_scheduler,
            commands::scheduler::get_scheduler_status,
            commands::scheduler::get_scan_history,
            commands::scheduler::get_scans,
            commands::scheduler::get_jobs_for_scan,
            commands::scheduler::clear_scans,
            // Web Search
            commands::web_search::run_web_search,
            // Export & Analytics
            commands::export::export_applications_csv,
            commands::export::export_applications_json,
            commands::export::export_jobs_csv,
            commands::export::get_analytics,
            commands::export::delete_all_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
