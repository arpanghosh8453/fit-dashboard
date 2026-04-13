use crate::{
    auth::{create_session, hash_password, verify_password},
    fit_parser::parse_fit_bytes,
    models::{Activity, OverviewStats, RecordPoint, TokenResponse},
    state::AppState,
};

pub fn status(state: &AppState) -> anyhow::Result<serde_json::Value> {
    Ok(serde_json::json!({ "needs_onboarding": !state.db.has_user()? }))
}

pub fn onboard(state: &AppState, username: String, password: String) -> anyhow::Result<TokenResponse> {
    if state.db.has_user()? {
        anyhow::bail!("user already exists");
    }
    let hash = hash_password(&password)?;
    state.db.create_user(&username, &hash)?;
    Ok(TokenResponse {
        token: create_session(&state.db)?,
    })
}

pub fn unlock(state: &AppState, password: String) -> anyhow::Result<TokenResponse> {
    let hash = state
        .db
        .get_password_hash()?
        .ok_or_else(|| anyhow::anyhow!("no user configured"))?;
    if !verify_password(&password, &hash)? {
        anyhow::bail!("invalid credentials");
    }
    Ok(TokenResponse {
        token: create_session(&state.db)?,
    })
}

pub fn logout(state: &AppState, token: String) -> anyhow::Result<()> {
    state.db.delete_session(&token)?;
    Ok(())
}

pub fn import_fit_bytes(state: &AppState, file_name: String, bytes: Vec<u8>) -> anyhow::Result<serde_json::Value> {
    let parsed = parse_fit_bytes(&file_name, &bytes)?;
    if state.db.is_file_imported(&parsed.file_hash)? {
        return Ok(serde_json::json!({ "status": "duplicate" }));
    }
    let activity_id = state.db.insert_activity(parsed)?;
    Ok(serde_json::json!({ "status": "ok", "activity_id": activity_id }))
}

pub fn list_activities(state: &AppState) -> anyhow::Result<Vec<Activity>> {
    state.db.list_activities()
}

pub fn get_overview(state: &AppState) -> anyhow::Result<OverviewStats> {
    state.db.overview()
}

pub fn get_records(state: &AppState, activity_id: i64, resolution_ms: i64) -> anyhow::Result<Vec<RecordPoint>> {
    state.db.records_downsampled(activity_id, resolution_ms)
}
