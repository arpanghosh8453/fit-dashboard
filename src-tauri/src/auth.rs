use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::{distributions::Alphanumeric, Rng};

use crate::database::Database;

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
const WEB_SESSION_TTL_ENV: &str = "FIT_DASHBOARD_SESSION_TTL";

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
fn web_session_ttl() -> chrono::Duration {
    let raw = std::env::var(WEB_SESSION_TTL_ENV).unwrap_or_else(|_| "72h".to_string());
    match parse_ttl_duration(&raw) {
        Some(v) if v.num_seconds() > 0 => v,
        _ => {
            tracing::warn!(env = WEB_SESSION_TTL_ENV, value = %raw, "invalid session TTL; using default 72h");
            chrono::Duration::hours(72)
        }
    }
}

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
fn parse_ttl_duration(input: &str) -> Option<chrono::Duration> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut digits_end = 0usize;
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_ascii_digit() {
            digits_end = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    if digits_end == 0 {
        return None;
    }

    let value: i64 = trimmed[..digits_end].parse().ok()?;
    let unit = trimmed[digits_end..].trim().to_ascii_lowercase();

    match unit.as_str() {
        "s" => Some(chrono::Duration::seconds(value)),
        "m" => Some(chrono::Duration::minutes(value)),
        "h" => Some(chrono::Duration::hours(value)),
        "d" => Some(chrono::Duration::days(value)),
        _ => None,
    }
}

pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("hash error: {e}"))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash).map_err(|e| anyhow!("invalid hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn create_session(db: &Database) -> Result<String> {
    let purged = db.purge_expired_sessions()?;
    if purged > 0 {
        tracing::info!(purged, "purged expired sessions before creating new session");
    }
    db.delete_sessions_for_user(1)?;

    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    #[cfg(all(feature = "web", not(feature = "tauri-app")))]
    let expiry = (chrono::Utc::now() + web_session_ttl()).to_rfc3339();

    #[cfg(any(not(feature = "web"), feature = "tauri-app"))]
    let expiry = (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339();

    db.insert_session(&token, &expiry)?;
    Ok(token)
}
