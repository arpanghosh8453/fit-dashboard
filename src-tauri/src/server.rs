use std::{path::Path as FsPath, sync::Arc, time::Duration};

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::{DefaultMakeSpan, DefaultOnRequest, TraceLayer};

use crate::{
    auth::{create_session, hash_password, verify_password},
    fit_parser::{is_non_activity_fit_error, parse_activity_bytes},
    models::{Credentials, RenameActivityPayload, TokenResponse, UnlockPayload},
    state::AppState,
};

const UNLOCK_FAILED_COUNT_KEY: &str = "auth.unlock.failed_count";
const UNLOCK_BLOCK_UNTIL_KEY: &str = "auth.unlock.block_until_utc";

#[derive(Deserialize)]
pub struct RecordsQuery {
    pub resolution_ms: Option<i64>,
}

/// SHA-256 hash of the valid supporter code.
const SUPPORTER_HASH: &str =
    "20268baf2f8af1792eaf2cd864c29b3b6698b4387810f39946fbccbc350bf5c3";
const SYNC_WAL_CHECKPOINT_EVERY_IMPORTED: usize = 10;

pub fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/status", get(status))
        .route("/api/onboard", post(onboard))
        .route("/api/unlock", post(unlock))
        .route("/api/logout", post(logout))
        .route("/api/import-fit", post(import_fit))
        .route("/api/sync-fit-files", post(sync_fit_files))
        .route("/api/sync-fit-files/list", get(list_sync_files))
        .route("/api/sync-fit-files/process", post(process_sync_file))
        .route("/api/storage-info", get(get_storage_info))
        .route("/api/blacklist/count", get(get_blacklisted_hash_count))
        .route("/api/blacklist/clear", post(clear_blacklisted_hashes))
        .route("/api/activities", get(list_activities))
        .route("/api/activities/{id}", patch(rename_activity).delete(delete_activity))
        .route("/api/overview", get(overview))
        .route("/api/records/{id}", get(records))
        .route("/api/supporter/verify", post(verify_supporter_code))
        .route("/api/supporter/status", get(get_supporter_status).post(set_supporter_status))
        .route("/api/supporter/donation", get(get_donation_dismissed).post(set_donation_dismissed))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(tracing::Level::DEBUG))
                .on_request(DefaultOnRequest::new().level(tracing::Level::DEBUG))
                .on_response(
                    |response: &axum::http::Response<_>, latency: Duration, _span: &tracing::Span| {
                        let status = response.status();
                        let latency_ms = latency.as_millis();

                        if status.is_server_error() {
                            tracing::error!(status = %status, latency_ms, "request completed with server error");
                        } else if status.is_client_error() {
                            tracing::warn!(status = %status, latency_ms, "request completed with client error");
                        } else {
                            tracing::info!(status = %status, latency_ms, "request completed");
                        }
                    },
                ),
        )
        .layer(cors)
        .with_state(Arc::new(state))
}

async fn status(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>, StatusCode> {
    tracing::debug!("status endpoint invoked");
    let has_user = state
        .db
        .has_user()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "needs_onboarding": !has_user })))
}

async fn onboard(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Credentials>,
) -> Result<Json<TokenResponse>, StatusCode> {
    tracing::info!(username = %payload.username, "onboard attempt");
    if state.db.has_user().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        tracing::warn!("onboard denied: user already exists");
        return Err(StatusCode::CONFLICT);
    }

    let hash = hash_password(&payload.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .db
        .create_user(&payload.username, &hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let token = create_session(&state.db).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!("onboard successful and session issued");
    Ok(Json(TokenResponse { token }))
}

async fn unlock(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UnlockPayload>,
) -> Result<Json<TokenResponse>, StatusCode> {
    if let Some(until) = get_unlock_block_until(&state)? {
        if chrono::Utc::now() < until {
            let wait_seconds = (until - chrono::Utc::now()).num_seconds().max(1);
            tracing::warn!(wait_seconds, "unlock temporarily blocked due to repeated failures");
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
    }

    let hash = state
        .db
        .get_password_hash()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let ok = verify_password(&payload.password, &hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !ok {
        let blocked = register_unlock_failure(&state)?;
        if blocked {
            tracing::warn!("unlock failed; applied 30-second throttle window");
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        tracing::warn!("unlock failed with invalid password");
        return Err(StatusCode::UNAUTHORIZED);
    }

    clear_unlock_throttle(&state)?;

    let token = create_session(&state.db).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!("unlock successful and session rotated");
    Ok(Json(TokenResponse { token }))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let token = extract_session(&state, &headers)?;
    state
        .db
        .delete_session(&token)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!("logout successful; session deleted");
    Ok(StatusCode::NO_CONTENT)
}

async fn import_fit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("import-fit request received");
    ensure_session(&state, &headers)
        .map_err(|s| (s, Json(serde_json::json!({ "error": "unauthorized" }))))?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "invalid multipart request" })),
            )
        })?
    {
        if field.name() != Some("file") {
            continue;
        }

        let file_name = field.file_name().unwrap_or("activity.fit").to_string();
        tracing::info!(file_name = %file_name, "processing activity upload");
        let bytes = field.bytes().await.map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "failed reading upload bytes" })),
            )
        })?;
        let hash = sha256_hex(&bytes);

        match state.db.is_hash_blacklisted(&hash) {
            Ok(true) => {
                tracing::info!(file_name = %file_name, file_hash = %hash, "upload skipped: blacklisted");
                return Ok(Json(serde_json::json!({ "status": "skipped" })));
            }
            Ok(false) => {}
            Err(_) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "database query failed" })),
                ));
            }
        }

        let parsed = match parse_activity_bytes(&file_name, &bytes) {
            Ok(v) => v,
            Err(e) => {
                if is_non_activity_fit_error(&e) {
                    state
                        .db
                        .add_blacklisted_hash(&hash)
                        .map_err(|_| {
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({ "error": "failed updating blacklist" })),
                            )
                        })?;
                    tracing::info!(file_name = %file_name, "upload skipped: non-activity FIT file");
                    return Ok(Json(serde_json::json!({ "status": "skipped" })));
                }
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": format!("parse failed: {e}") })),
                ));
            }
        };

        // Manual imports always clear blacklist for this hash.
        state
            .db
            .remove_blacklisted_hash(&parsed.file_hash)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed updating blacklist" })),
                )
            })?;

        if state
            .db
            .is_file_imported(&parsed.file_hash)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "database query failed" })),
                )
            })?
        {
            tracing::info!(file_name = %file_name, file_hash = %parsed.file_hash, "duplicate activity upload skipped");
            return Ok(Json(serde_json::json!({ "status": "duplicate" })));
        }

        if state
            .db
            .activity_exists_with_exact_times(&parsed.start_ts_utc, &parsed.end_ts_utc)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "database query failed" })),
                )
            })?
        {
            tracing::info!(file_name = %file_name, start_ts = %parsed.start_ts_utc, end_ts = %parsed.end_ts_utc, "duplicate activity upload skipped: start/end timestamps already exist");
            return Ok(Json(serde_json::json!({ "status": "duplicate" })));
        }

        let source_format = parsed.source_format.clone();
        let file_hash = parsed.file_hash.clone();
        let id = state
            .db
            .insert_activity(parsed)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed inserting activity" })),
                )
            })?;

        if let Err(e) = persist_fit_file(&state, &file_name, &bytes, &file_hash).await {
            tracing::error!(activity_id = id, file_name = %file_name, error = %e, "upload persistence failed after DB insert; rolling back activity");
            if let Err(rb_err) = state.db.delete_activity(id) {
                tracing::error!(activity_id = id, file_name = %file_name, error = %rb_err, "rollback failed after upload persistence error");
            }
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("failed storing file: {e}") })),
            ));
        }

        tracing::info!(activity_id = id, file_name = %file_name, source_format = %source_format, "activity upload imported successfully");
        return Ok(Json(serde_json::json!({ "status": "ok", "activity_id": id })));
    }

    Err((
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": "no file field found; expected field named 'file'" })),
    ))
}

async fn list_activities(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let rows = state
        .db
        .list_activities()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::debug!(count = rows.len(), "list_activities completed");
    Ok(Json(serde_json::json!(rows)))
}

async fn overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let stats = state
        .db
        .overview()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::debug!(
        activity_count = stats.activity_count,
        total_distance_m = stats.total_distance_m,
        total_duration_s = stats.total_duration_s,
        "overview completed"
    );
    Ok(Json(serde_json::json!(stats)))
}

async fn records(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<RecordsQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let resolution = q.resolution_ms.unwrap_or(10_000);
    let rows = state
        .db
        .records_downsampled(id, resolution)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::debug!(activity_id = id, resolution_ms = resolution, count = rows.len(), "records completed");
    Ok(Json(serde_json::json!(rows)))
}

async fn rename_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<RenameActivityPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    ensure_session(&state, &headers)?;
    tracing::info!(activity_id = id, "rename_activity endpoint invoked");
    let name = payload.name.trim();
    if name.is_empty() {
        tracing::warn!(activity_id = id, "rename_activity rejected: empty name");
        return Err(StatusCode::BAD_REQUEST);
    }

    let changed = state
        .db
        .rename_activity(id, name)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !changed {
        tracing::warn!(activity_id = id, "rename_activity failed: not found");
        return Err(StatusCode::NOT_FOUND);
    }
    tracing::info!(activity_id = id, "rename_activity completed");
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    ensure_session(&state, &headers)?;
    tracing::info!(activity_id = id, "delete_activity endpoint invoked");
    let file_hash = state
        .db
        .get_activity_hash(id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let changed = state
        .db
        .delete_activity(id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !changed {
        tracing::warn!(activity_id = id, "delete_activity failed: not found");
        return Err(StatusCode::NOT_FOUND);
    }
    if let Some(hash) = file_hash {
        state
            .db
            .add_blacklisted_hash(&hash)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tracing::info!(activity_id = id, "delete_activity completed");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct SyncSummary {
    scanned: usize,
    imported: usize,
    duplicates: usize,
    blacklisted: usize,
    skipped: usize,
    failed: usize,
}

async fn sync_fit_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    tracing::info!("sync-fit-files request received");
    ensure_session(&state, &headers)?;

    let mut summary = SyncSummary {
        scanned: 0,
        imported: 0,
        duplicates: 0,
        blacklisted: 0,
        skipped: 0,
        failed: 0,
    };
    let mut imported_since_checkpoint = 0usize;

    let mut dir = tokio::fs::read_dir(&state.storage.fit_files_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let path = entry.path();
        if !is_supported_activity_file(&path) {
            continue;
        }

        summary.scanned += 1;
        let bytes = match tokio::fs::read(&path).await {
            Ok(b) => b,
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

        let parsed = match parse_activity_bytes(&file_name, &bytes) {
            Ok(v) => v,
            Err(e) => {
                if is_non_activity_fit_error(&e) {
                    if state.db.add_blacklisted_hash(&hash).is_err() {
                        summary.failed += 1;
                        continue;
                    }
                    if is_fit_file(&path)
                        && move_sync_file_to_incompatible(&state, &path, &hash)
                            .await
                            .is_err()
                    {
                        summary.failed += 1;
                        continue;
                    }
                    summary.skipped += 1;
                } else {
                    if is_fit_file(&path)
                        && move_sync_file_to_incompatible(&state, &path, &hash)
                            .await
                            .is_ok()
                    {
                        summary.skipped += 1;
                    } else {
                        summary.failed += 1;
                    }
                }
                continue;
            }
        };

        match state
            .db
            .activity_exists_with_exact_times(&parsed.start_ts_utc, &parsed.end_ts_utc)
        {
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

        match state.db.insert_activity(parsed) {
            Ok(_) => {
                summary.imported += 1;
                imported_since_checkpoint += 1;
                if imported_since_checkpoint >= SYNC_WAL_CHECKPOINT_EVERY_IMPORTED {
                    state
                        .db
                        .flush_wal_to_disk()
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                    imported_since_checkpoint = 0;
                }
            }
            Err(_) => summary.failed += 1,
        }
    }

    if imported_since_checkpoint > 0 {
        state
            .db
            .flush_wal_to_disk()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    tracing::info!(
        scanned = summary.scanned,
        imported = summary.imported,
        duplicates = summary.duplicates,
        blacklisted = summary.blacklisted,
        skipped = summary.skipped,
        failed = summary.failed,
        "sync-fit-files completed"
    );

    Ok(Json(serde_json::json!(summary)))
}

async fn list_sync_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let mut files = Vec::new();
    let mut dir = tokio::fs::read_dir(&state.storage.fit_files_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let path = entry.path();
        if is_supported_activity_file(&path) {
            let bytes = match tokio::fs::read(&path).await {
                Ok(b) => b,
                Err(_) => continue,
            };
            if bytes.is_empty() {
                continue;
            }
            let hash = sha256_hex(&bytes);

            if let Ok(true) = state.db.is_hash_blacklisted(&hash) {
                continue;
            }
            if let Ok(true) = state.db.is_file_imported(&hash) {
                continue;
            }
            files.push(path.to_string_lossy().to_string());
        }
    }

    files.sort();
    Ok(Json(serde_json::json!(files)))
}

#[derive(Deserialize)]
struct SyncFilePayload {
    path: String,
}

async fn process_sync_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<SyncFilePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let path = std::path::Path::new(&payload.path);
    if !is_supported_activity_file(path) {
        return Ok(Json(serde_json::json!({ "status": "ignored", "file": payload.path })));
    }

    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("activity")
        .to_string();

    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let hash = sha256_hex(&bytes);

    match state.db.is_hash_blacklisted(&hash) {
        Ok(true) => {
            tracing::info!(file = %file_name, "sync file skipped: blacklisted");
            return Ok(Json(serde_json::json!({ "status": "blacklisted", "file": file_name })));
        }
        Ok(false) => {}
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    }

    match state.db.is_file_imported(&hash) {
        Ok(true) => {
            tracing::info!(file = %file_name, "sync file skipped: duplicate");
            return Ok(Json(serde_json::json!({ "status": "duplicate", "file": file_name })));
        }
        Ok(false) => {}
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    }

    let parsed = match parse_activity_bytes(&file_name, &bytes) {
        Ok(v) => v,
        Err(e) => {
            if is_non_activity_fit_error(&e) {
                state
                    .db
                    .add_blacklisted_hash(&hash)
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                if is_fit_file(path) {
                    move_sync_file_to_incompatible(&state, path, &hash)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
                tracing::info!(file = %file_name, "sync file skipped: non-activity FIT file");
                return Ok(Json(serde_json::json!({ "status": "skipped", "file": file_name })));
            }
            if is_fit_file(path) {
                move_sync_file_to_incompatible(&state, path, &hash)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                tracing::info!(file = %file_name, "sync file skipped: incompatible FIT file moved to incompatible");
                return Ok(Json(serde_json::json!({ "status": "skipped", "file": file_name })));
            }
            return Err(StatusCode::BAD_REQUEST);
        }
    };

    match state
        .db
        .activity_exists_with_exact_times(&parsed.start_ts_utc, &parsed.end_ts_utc)
    {
        Ok(true) => {
            tracing::info!(file = %file_name, start_ts = %parsed.start_ts_utc, end_ts = %parsed.end_ts_utc, "sync file skipped: duplicate start/end timestamps");
            return Ok(Json(serde_json::json!({ "status": "duplicate", "file": file_name })));
        }
        Ok(false) => {}
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    }

    state
        .db
        .insert_activity(parsed)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!(file = %file_name, "sync file imported");

    Ok(Json(serde_json::json!({ "status": "imported", "file": file_name })))
}

async fn get_storage_info(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    tracing::debug!("get_storage_info completed");
    Ok(Json(serde_json::json!({
        "data_dir": state.storage.data_dir.clone(),
        "db_path": state.storage.db_path.clone(),
        "fit_files_dir": state.storage.fit_files_dir.clone()
    })))
}

async fn clear_blacklisted_hashes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let removed = state
        .db
        .clear_blacklisted_hashes()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!(removed, "clear_blacklisted_hashes completed");
    Ok(Json(serde_json::json!({ "removed": removed })))
}

async fn get_blacklisted_hash_count(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let count = state
        .db
        .blacklisted_hash_count()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "count": count })))
}

fn extract_session(state: &AppState, headers: &HeaderMap) -> Result<String, StatusCode> {
    let token = headers
        .get("X-Session")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_string();

    if !state
        .db
        .session_valid(&token)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        tracing::warn!("session validation failed");
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(token)
}

fn ensure_session(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    extract_session(state, headers).map(|_| ())
}

// ============================================================================
// SUPPORTER BADGE
// ============================================================================

#[derive(Deserialize)]
struct VerifySupporterPayload {
    code: String,
}

async fn verify_supporter_code(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<VerifySupporterPayload>,
) -> Result<Json<bool>, StatusCode> {
    use sha2::{Digest, Sha256};

    let trimmed = payload.code.trim().to_string();
    if trimmed.is_empty() {
        tracing::warn!("verify_supporter_code rejected: empty code");
        return Ok(Json(false));
    }

    let mut hasher = Sha256::new();
    hasher.update(trimmed.as_bytes());
    let hash_bytes = hasher.finalize();
    let hash_hex: String = hash_bytes.iter().map(|b| format!("{:02x}", b)).collect();

    if hash_hex != SUPPORTER_HASH {
        tracing::warn!("verify_supporter_code rejected: invalid code");
        return Ok(Json(false));
    }

    state
        .db
        .set_setting("supporter_badge_active", "true")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .db
        .set_setting("donation_dismissed", "true")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tracing::info!("verify_supporter_code accepted and supporter status enabled");

    Ok(Json(true))
}

async fn get_supporter_status(
    State(state): State<Arc<AppState>>,
) -> Json<bool> {
    let active = state
        .db
        .get_setting("supporter_badge_active")
        .ok()
        .flatten()
        .as_deref()
        == Some("true");
    tracing::debug!(active, "get_supporter_status completed");
    Json(active)
}

async fn get_donation_dismissed(
    State(state): State<Arc<AppState>>,
) -> Json<bool> {
    let dismissed = state
        .db
        .get_setting("donation_dismissed")
        .ok()
        .flatten()
        .as_deref()
        == Some("true");
    tracing::debug!(dismissed, "get_donation_dismissed completed");
    Json(dismissed)
}

#[derive(Deserialize)]
struct DonationDismissedPayload {
    dismissed: bool,
}

#[derive(Deserialize)]
struct SupporterStatusPayload {
    active: bool,
}

async fn set_supporter_status(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SupporterStatusPayload>,
) -> Result<Json<bool>, StatusCode> {
    state
        .db
        .set_setting(
            "supporter_badge_active",
            if payload.active { "true" } else { "false" },
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!(active = payload.active, "set_supporter_status completed");
    Ok(Json(payload.active))
}

async fn set_donation_dismissed(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DonationDismissedPayload>,
) -> Result<Json<bool>, StatusCode> {
    state
        .db
        .set_setting(
            "donation_dismissed",
            if payload.dismissed { "true" } else { "false" },
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!(dismissed = payload.dismissed, "set_donation_dismissed completed");
    Ok(Json(payload.dismissed))
}

fn get_unlock_block_until(state: &AppState) -> Result<Option<chrono::DateTime<chrono::Utc>>, StatusCode> {
    let raw = state
        .db
        .get_setting(UNLOCK_BLOCK_UNTIL_KEY)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    let parsed = chrono::DateTime::parse_from_rfc3339(&raw)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .with_timezone(&chrono::Utc);
    Ok(Some(parsed))
}

fn register_unlock_failure(state: &AppState) -> Result<bool, StatusCode> {
    let prev = state
        .db
        .get_setting(UNLOCK_FAILED_COUNT_KEY)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let next = prev + 1;
    state
        .db
        .set_setting(UNLOCK_FAILED_COUNT_KEY, &next.to_string())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if next % 5 == 0 {
        let block_until = chrono::Utc::now() + chrono::Duration::seconds(30);
        state
            .db
            .set_setting(UNLOCK_BLOCK_UNTIL_KEY, &block_until.to_rfc3339())
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(true);
    }

    Ok(false)
}

fn clear_unlock_throttle(state: &AppState) -> Result<(), StatusCode> {
    state
        .db
        .delete_setting(UNLOCK_FAILED_COUNT_KEY)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .db
        .delete_setting(UNLOCK_BLOCK_UNTIL_KEY)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn is_supported_activity_file(path: &FsPath) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            e.eq_ignore_ascii_case("fit")
                || e.eq_ignore_ascii_case("tcx")
                || e.eq_ignore_ascii_case("gpx")
        })
        .unwrap_or(false)
}

fn is_fit_file(path: &FsPath) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("fit"))
        .unwrap_or(false)
}

async fn move_sync_file_to_incompatible(
    state: &AppState,
    source_path: &FsPath,
    file_hash: &str,
) -> Result<(), anyhow::Error> {
    let fit_dir = FsPath::new(&state.storage.fit_files_dir);
    let incompatible_dir = fit_dir.join("incompatible");
    tokio::fs::create_dir_all(&incompatible_dir).await?;

    let file_name = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("activity.fit");

    let mut target = incompatible_dir.join(file_name);
    if let Ok(existing) = tokio::fs::read(&target).await {
        let existing_hash = sha256_hex(&existing);
        if existing_hash == file_hash {
            tokio::fs::remove_file(source_path).await?;
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
        target = incompatible_dir.join(format!("{stem}_{suffix}.{ext}"));

        if let Ok(existing_renamed) = tokio::fs::read(&target).await {
            let existing_hash = sha256_hex(&existing_renamed);
            if existing_hash == file_hash {
                tokio::fs::remove_file(source_path).await?;
                return Ok(());
            }
        }
    }

    if tokio::fs::rename(source_path, &target).await.is_err() {
        tokio::fs::copy(source_path, &target).await?;
        tokio::fs::remove_file(source_path).await?;
    }

    tracing::info!(source = %source_path.display(), destination = %target.display(), "moved incompatible sync file");
    Ok(())
}

async fn persist_fit_file(
    state: &AppState,
    original_name: &str,
    bytes: &[u8],
    file_hash: &str,
) -> Result<(), anyhow::Error> {
    let fit_dir = FsPath::new(&state.storage.fit_files_dir);
    tokio::fs::create_dir_all(fit_dir).await?;

    let sanitized = FsPath::new(original_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("activity.fit");

    let mut target = fit_dir.join(sanitized);
    if let Ok(existing) = tokio::fs::read(&target).await {
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

        if let Ok(existing_renamed) = tokio::fs::read(&target).await {
            let existing_hash = sha256_hex(&existing_renamed);
            if existing_hash == file_hash {
                return Ok(());
            }
        }
    }

    tokio::fs::write(target, bytes).await?;
    Ok(())
}
