use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: i64,
    pub file_name: String,
    pub activity_name: String,
    pub sport: String,
    pub device: String,
    pub start_ts_utc: String,
    pub end_ts_utc: String,
    pub duration_s: f64,
    pub distance_m: f64,
    pub start_latitude: Option<f64>,
    pub start_longitude: Option<f64>,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordPoint {
    pub timestamp_ms: i64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_m: Option<f64>,
    pub distance_m: Option<f64>,
    pub speed_m_s: Option<f64>,
    pub cadence: Option<i64>,
    pub heart_rate: Option<i64>,
    pub power: Option<i64>,
    pub temperature_c: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ParsedActivity {
    pub file_name: String,
    pub source_format: String,
    pub activity_name: String,
    pub sport: String,
    pub device: String,
    pub start_ts_utc: String,
    pub end_ts_utc: String,
    pub duration_s: f64,
    pub distance_m: f64,
    pub start_latitude: Option<f64>,
    pub start_longitude: Option<f64>,
    pub file_hash: String,
    pub records: Vec<RecordPoint>,
    pub metadata_json: String,
}

#[derive(Debug, Serialize)]
pub struct OverviewStats {
    pub activity_count: i64,
    pub total_distance_m: f64,
    pub total_duration_s: f64,
}

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
#[derive(Debug, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
#[derive(Debug, Deserialize)]
pub struct UnlockPayload {
    pub password: String,
}

#[cfg(all(feature = "web", not(feature = "tauri-app")))]
#[derive(Debug, Deserialize)]
pub struct RenameActivityPayload {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub token: String,
}
