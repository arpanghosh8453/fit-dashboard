use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use tower_http::cors::{Any, CorsLayer};

use crate::{
    auth::{create_session, hash_password, verify_password},
    fit_parser::parse_fit_bytes,
    models::{Credentials, RenameActivityPayload, TokenResponse, UnlockPayload},
    state::AppState,
};

#[derive(Deserialize)]
pub struct RecordsQuery {
    pub resolution_ms: Option<i64>,
}

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
        .route("/api/activities", get(list_activities))
        .route("/api/activities/{id}", patch(rename_activity).delete(delete_activity))
        .route("/api/overview", get(overview))
        .route("/api/records/{id}", get(records))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(cors)
        .with_state(Arc::new(state))
}

async fn status(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>, StatusCode> {
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
    if state.db.has_user().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::CONFLICT);
    }

    let hash = hash_password(&payload.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .db
        .create_user(&payload.username, &hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let token = create_session(&state.db).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(TokenResponse { token }))
}

async fn unlock(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UnlockPayload>,
) -> Result<Json<TokenResponse>, StatusCode> {
    let hash = state
        .db
        .get_password_hash()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let ok = verify_password(&payload.password, &hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = create_session(&state.db).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
    Ok(StatusCode::NO_CONTENT)
}

async fn import_fit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
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
        let bytes = field.bytes().await.map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "failed reading upload bytes" })),
            )
        })?;
        let parsed = parse_fit_bytes(&file_name, &bytes).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("parse failed: {e}") })),
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
            return Ok(Json(serde_json::json!({ "status": "duplicate" })));
        }

        let id = state
            .db
            .insert_activity(parsed)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed inserting activity" })),
                )
            })?;
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
    Ok(Json(serde_json::json!(stats)))
}

async fn records(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<RecordsQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    ensure_session(&state, &headers)?;
    let rows = state
        .db
        .records_downsampled(id, q.resolution_ms.unwrap_or(10_000))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!(rows)))
}

async fn rename_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<RenameActivityPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    ensure_session(&state, &headers)?;
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let changed = state
        .db
        .rename_activity(id, name)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    ensure_session(&state, &headers)?;
    let changed = state
        .db
        .delete_activity(id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
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
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(token)
}

fn ensure_session(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    extract_session(state, headers).map(|_| ())
}
