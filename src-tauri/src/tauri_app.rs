use std::path::Path;

use serde::Serialize;
use tauri::{Manager, State};

use crate::{
    auth::{create_session, hash_password, verify_password},
    fit_parser::parse_activity_bytes,
    models::{Activity, OverviewStats, RecordPoint, TokenResponse},
    state::{AppState, StorageInfo},
};

/// SHA-256 hash of the valid supporter code.
const SUPPORTER_HASH: &str =
    "20268baf2f8af1792eaf2cd864c29b3b6698b4387810f39946fbccbc350bf5c3";

#[derive(Serialize)]
struct SyncSummary {
    scanned: usize,
    imported: usize,
    duplicates: usize,
    blacklisted: usize,
    failed: usize,
}

pub fn run(state: AppState) -> anyhow::Result<()> {
    tracing::info!("starting tauri app runtime");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_state = window.app_handle().state::<AppState>();
                if let Err(err) = app_state.db.flush_wal_to_disk() {
                    tracing::error!(error = %err, "failed to checkpoint DB on close request");
                } else {
                    tracing::debug!("duckdb checkpoint completed on close request");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            status,
            onboard,
            unlock,
            logout,
            import_fit_bytes,
            import_activity_path,
            sync_fit_files,
            get_storage_info,
            list_activities,
            get_overview,
            get_records,
            rename_activity,
            delete_activity,
            verify_supporter_code,
            get_supporter_status,
            set_supporter_status,
            get_donation_dismissed,
            set_donation_dismissed,
        ])
        .build(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    app.run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let app_state = app_handle.state::<AppState>();
                if let Err(err) = app_state.db.flush_wal_to_disk() {
                    tracing::error!(error = %err, "failed to checkpoint DB on exit request");
                } else {
                    tracing::debug!("duckdb checkpoint completed on exit request");
                }
            }
        });
    Ok(())
}

#[tauri::command]
fn status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    tracing::debug!("status command invoked");
    Ok(serde_json::json!({
        "needs_onboarding": !state.db.has_user().map_err(|e| e.to_string())?
    }))
}

#[tauri::command]
fn onboard(state: State<'_, AppState>, username: String, password: String) -> Result<TokenResponse, String> {
    tracing::info!(username = %username, "onboard command invoked");
    if state.db.has_user().map_err(|e| e.to_string())? {
        tracing::warn!("onboard denied: user already exists");
        return Err("user already exists".to_string());
    }

    let hash = hash_password(&password).map_err(|e| e.to_string())?;
    state
        .db
        .create_user(&username, &hash)
        .map_err(|e| e.to_string())?;

    let token = create_session(&state.db).map_err(|e| e.to_string())?;
    tracing::info!("onboard successful and session issued");
    Ok(TokenResponse { token })
}

#[tauri::command]
fn unlock(state: State<'_, AppState>, password: String) -> Result<TokenResponse, String> {
    tracing::info!("unlock command invoked");
    let hash = state
        .db
        .get_password_hash()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no user configured".to_string())?;

    let ok = verify_password(&password, &hash).map_err(|e| e.to_string())?;
    if !ok {
        tracing::warn!("unlock failed with invalid credentials");
        return Err("invalid credentials".to_string());
    }

    let token = create_session(&state.db).map_err(|e| e.to_string())?;
    tracing::info!("unlock successful and session issued");
    Ok(TokenResponse { token })
}

#[tauri::command]
fn logout(state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("logout command invoked");
    state
        .db
        .delete_sessions_for_user(1)
        .map_err(|e| e.to_string())?;
    tracing::info!("logout completed: cleared user sessions");
    Ok(())
}

#[tauri::command]
fn import_fit_bytes(
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<serde_json::Value, String> {
    tracing::info!(file_name = %file_name, bytes = bytes.len(), "import_fit_bytes command invoked");
    import_activity_inner(&state, &file_name, &bytes)
}

#[tauri::command]
fn import_activity_path(state: State<'_, AppState>, path: String) -> Result<serde_json::Value, String> {
    tracing::info!(path = %path, "import_activity_path command invoked");
    let bytes = std::fs::read(&path).map_err(|e| format!("failed reading file: {e}"))?;
    let file_name = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("activity")
        .to_string();
    import_activity_inner(&state, &file_name, &bytes)
}

fn import_activity_inner(
    state: &State<'_, AppState>,
    file_name: &str,
    bytes: &[u8],
) -> Result<serde_json::Value, String> {
    tracing::debug!(file_name = %file_name, bytes = bytes.len(), "processing import payload");
    let parsed = parse_activity_bytes(file_name, bytes).map_err(|e| e.to_string())?;

    state
        .db
        .remove_blacklisted_hash(&parsed.file_hash)
        .map_err(|e| e.to_string())?;

    if state
        .db
        .is_file_imported(&parsed.file_hash)
        .map_err(|e| e.to_string())?
    {
        tracing::info!(file_name = %file_name, "import skipped: duplicate file hash");
        return Ok(serde_json::json!({ "status": "duplicate" }));
    }

    persist_fit_file(state, file_name, bytes, &parsed.file_hash).map_err(|e| e.to_string())?;
    let activity_id = state.db.insert_activity(parsed).map_err(|e| e.to_string())?;
    tracing::info!(file_name = %file_name, activity_id, "import completed successfully");

    Ok(serde_json::json!({ "status": "ok", "activity_id": activity_id }))
}

#[tauri::command]
fn sync_fit_files(state: State<'_, AppState>) -> Result<SyncSummary, String> {
    tracing::info!(fit_dir = %state.storage.fit_files_dir, "sync_fit_files command invoked");
    let mut summary = SyncSummary {
        scanned: 0,
        imported: 0,
        duplicates: 0,
        blacklisted: 0,
        failed: 0,
    };

    let read_dir = std::fs::read_dir(&state.storage.fit_files_dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => {
                summary.failed += 1;
                continue;
            }
        };
        let path = entry.path();
        if !is_supported_activity_file(&path) {
            continue;
        }

        summary.scanned += 1;
        let bytes = match std::fs::read(&path) {
            Ok(v) => v,
            Err(_) => {
                summary.failed += 1;
                continue;
            }
        };
        let hash = sha256_hex(&bytes);

        match state.db.is_hash_blacklisted(&hash) {
            Ok(true) => {
                summary.blacklisted += 1;
                continue;
            }
            Ok(false) => {}
            Err(_) => {
                summary.failed += 1;
                continue;
            }
        }

        match state.db.is_file_imported(&hash) {
            Ok(true) => {
                summary.duplicates += 1;
                continue;
            }
            Ok(false) => {}
            Err(_) => {
                summary.failed += 1;
                continue;
            }
        }

        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("activity")
            .to_string();
        match parse_activity_bytes(&file_name, &bytes)
            .and_then(|parsed| state.db.insert_activity(parsed).map(|_| ()))
        {
            Ok(_) => summary.imported += 1,
            Err(_) => summary.failed += 1,
        }
    }

    tracing::info!(
        scanned = summary.scanned,
        imported = summary.imported,
        duplicates = summary.duplicates,
        blacklisted = summary.blacklisted,
        failed = summary.failed,
        "sync_fit_files completed"
    );
    Ok(summary)
}

#[tauri::command]
fn get_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    Ok(state.storage.as_ref().clone())
}

#[tauri::command]
fn list_activities(state: State<'_, AppState>) -> Result<Vec<Activity>, String> {
    let activities = state.db.list_activities().map_err(|e| e.to_string())?;
    tracing::debug!(count = activities.len(), "list_activities completed");
    Ok(activities)
}

#[tauri::command]
fn get_overview(state: State<'_, AppState>) -> Result<OverviewStats, String> {
    let overview = state.db.overview().map_err(|e| e.to_string())?;
    tracing::debug!(
        activity_count = overview.activity_count,
        total_distance_m = overview.total_distance_m,
        total_duration_s = overview.total_duration_s,
        "get_overview completed"
    );
    Ok(overview)
}

#[tauri::command]
fn get_records(
    state: State<'_, AppState>,
    activity_id: i64,
    resolution_ms: Option<i64>,
) -> Result<Vec<RecordPoint>, String> {
    let effective_resolution = resolution_ms.unwrap_or(10_000);
    let records = state
        .db
        .records_downsampled(activity_id, effective_resolution)
        .map_err(|e| e.to_string())?;
    tracing::debug!(
        activity_id,
        resolution_ms = effective_resolution,
        count = records.len(),
        "get_records completed"
    );
    Ok(records)
}

#[tauri::command]
fn rename_activity(state: State<'_, AppState>, activity_id: i64, name: String) -> Result<(), String> {
    tracing::info!(activity_id, "rename_activity command invoked");
    let trimmed = name.trim();
    if trimmed.is_empty() {
        tracing::warn!(activity_id, "rename rejected: empty name");
        return Err("name cannot be empty".to_string());
    }
    let changed = state
        .db
        .rename_activity(activity_id, trimmed)
        .map_err(|e| e.to_string())?;
    if !changed {
        tracing::warn!(activity_id, "rename failed: activity not found");
        return Err("activity not found".to_string());
    }
    tracing::info!(activity_id, "rename_activity completed");
    Ok(())
}

#[tauri::command]
fn delete_activity(state: State<'_, AppState>, activity_id: i64) -> Result<(), String> {
    tracing::info!(activity_id, "delete_activity command invoked");
    let file_hash = state
        .db
        .get_activity_hash(activity_id)
        .map_err(|e| e.to_string())?;
    let changed = state
        .db
        .delete_activity(activity_id)
        .map_err(|e| e.to_string())?;
    if !changed {
        tracing::warn!(activity_id, "delete failed: activity not found");
        return Err("activity not found".to_string());
    }

    if let Some(hash) = file_hash {
        state
            .db
            .add_blacklisted_hash(&hash)
            .map_err(|e| e.to_string())?;
    }
    tracing::info!(activity_id, "delete_activity completed");
    Ok(())
}

#[tauri::command]
fn verify_supporter_code(state: State<'_, AppState>, code: String) -> Result<bool, String> {
    use sha2::{Digest, Sha256};

    let trimmed = code.trim().to_string();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let mut hasher = Sha256::new();
    hasher.update(trimmed.as_bytes());
    let hash_hex = hex::encode(hasher.finalize());
    if hash_hex != SUPPORTER_HASH {
        return Ok(false);
    }

    state
        .db
        .set_setting("supporter_badge_active", "true")
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("donation_dismissed", "true")
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_supporter_status(state: State<'_, AppState>) -> Result<bool, String> {
    let active = state
        .db
        .get_setting("supporter_badge_active")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("true");
    Ok(active)
}

#[tauri::command]
fn set_supporter_status(state: State<'_, AppState>, active: bool) -> Result<bool, String> {
    state
        .db
        .set_setting("supporter_badge_active", if active { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    Ok(active)
}

#[tauri::command]
fn get_donation_dismissed(state: State<'_, AppState>) -> Result<bool, String> {
    let dismissed = state
        .db
        .get_setting("donation_dismissed")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("true");
    Ok(dismissed)
}

#[tauri::command]
fn set_donation_dismissed(state: State<'_, AppState>, dismissed: bool) -> Result<bool, String> {
    state
        .db
        .set_setting("donation_dismissed", if dismissed { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    Ok(dismissed)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn is_supported_activity_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            e.eq_ignore_ascii_case("fit")
                || e.eq_ignore_ascii_case("tcx")
                || e.eq_ignore_ascii_case("gpx")
        })
        .unwrap_or(false)
}

fn persist_fit_file(
    state: &AppState,
    original_name: &str,
    bytes: &[u8],
    file_hash: &str,
) -> Result<(), anyhow::Error> {
    let fit_dir = Path::new(&state.storage.fit_files_dir);
    std::fs::create_dir_all(fit_dir)?;

    let sanitized = Path::new(original_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("activity.fit");

    let mut target = fit_dir.join(sanitized);
    if let Ok(existing) = std::fs::read(&target) {
        let existing_hash = sha256_hex(&existing);
        if existing_hash == file_hash {
            return Ok(());
        }

        let stem = target
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("activity");
        let ext = target
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("fit");
        let suffix = &file_hash[..8.min(file_hash.len())];
        target = fit_dir.join(format!("{stem}_{suffix}.{ext}"));

        if let Ok(existing_renamed) = std::fs::read(&target) {
            let existing_hash = sha256_hex(&existing_renamed);
            if existing_hash == file_hash {
                return Ok(());
            }
        }
    }

    std::fs::write(target, bytes)?;
    Ok(())
}
