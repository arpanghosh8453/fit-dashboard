use std::sync::Mutex;

use anyhow::{Context, Result};
use duckdb::{params, Connection};

use crate::models::{Activity, OverviewStats, ParsedActivity, RecordPoint};

pub struct Database {
    conn: Mutex<Connection>,
    db_path: String,
}

const WAL_LIMIT_BYTES: u64 = 25 * 1024 * 1024;

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        tracing::info!(db_path = %path, "opening duckdb database");
        let conn = Connection::open(path).context("failed to open DuckDB")?;
        let db = Self {
            conn: Mutex::new(conn),
            db_path: path.to_string(),
        };
        db.init_schema()?;
        tracing::info!(db_path = %path, "duckdb initialized successfully");
        Ok(db)
    }

    fn wal_path(&self) -> std::path::PathBuf {
        std::path::PathBuf::from(format!("{}.wal", self.db_path))
    }

    pub fn flush_wal_to_disk(&self) -> Result<()> {
        tracing::debug!(db_path = %self.db_path, "running duckdb checkpoint");
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute_batch("CHECKPOINT")
            .context("duckdb checkpoint failed")?;
        tracing::info!(db_path = %self.db_path, "duckdb checkpoint completed");
        Ok(())
    }

    pub fn checkpoint_if_wal_exceeds_limit(&self) -> Result<bool> {
        let wal_size = std::fs::metadata(self.wal_path())
            .map(|m| m.len())
            .unwrap_or(0);
        if wal_size <= WAL_LIMIT_BYTES {
            return Ok(false);
        }
        tracing::warn!(
            db_path = %self.db_path,
            wal_size_bytes = wal_size,
            wal_limit_bytes = WAL_LIMIT_BYTES,
            "wal size exceeded threshold; forcing checkpoint"
        );
        self.flush_wal_to_disk()?;
        Ok(true)
    }

    fn init_schema(&self) -> Result<()> {
        tracing::debug!(db_path = %self.db_path, "initializing database schema");
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username VARCHAR NOT NULL UNIQUE,
                password_hash VARCHAR NOT NULL,
                created_at TIMESTAMP DEFAULT now()
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token VARCHAR PRIMARY KEY,
                user_id BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT now(),
                expires_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activities (
                id BIGINT PRIMARY KEY,
                file_hash VARCHAR NOT NULL UNIQUE,
                file_name VARCHAR NOT NULL,
                activity_name VARCHAR NOT NULL,
                sport VARCHAR,
                device VARCHAR,
                start_ts_utc TIMESTAMP,
                end_ts_utc TIMESTAMP,
                duration_s REAL,
                distance_m REAL,
                source VARCHAR,
                imported_at TIMESTAMP DEFAULT now(),
                metadata_json VARCHAR
            );

            CREATE TABLE IF NOT EXISTS records (
                activity_id BIGINT NOT NULL,
                timestamp_ms BIGINT NOT NULL,
                latitude DOUBLE,
                longitude DOUBLE,
                altitude_m REAL,
                distance_m REAL,
                speed_m_s REAL,
                cadence BIGINT,
                heart_rate BIGINT,
                power BIGINT,
                temperature_c REAL,
                raw_fields_json VARCHAR
            );

            CREATE INDEX IF NOT EXISTS idx_records_activity_time ON records(activity_id, timestamp_ms);
            CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities(start_ts_utc);

            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR PRIMARY KEY,
                value VARCHAR NOT NULL
            );

            CREATE TABLE IF NOT EXISTS file_hash_blacklist (
                file_hash VARCHAR PRIMARY KEY,
                created_at TIMESTAMP DEFAULT now()
            );
            "#,
        )?;

        self.migrate_numeric_types_if_needed(&conn)?;

        // Re-assert indexes after any table rebuild migration.
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_records_activity_time ON records(activity_id, timestamp_ms)",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities(start_ts_utc)",
            [],
        );
        Ok(())
    }

    fn migrate_numeric_types_if_needed(&self, conn: &Connection) -> Result<()> {
        let activities_needs_migration =
            !column_type_matches(conn, "activities", "duration_s", "REAL")?
                || !column_type_matches(conn, "activities", "distance_m", "REAL")?;

        if activities_needs_migration {
            tracing::info!("migrating activities numeric column types");
            conn.execute_batch(
                r#"
                CREATE TABLE activities_migrated (
                    id BIGINT PRIMARY KEY,
                    file_hash VARCHAR NOT NULL UNIQUE,
                    file_name VARCHAR NOT NULL,
                    activity_name VARCHAR NOT NULL,
                    sport VARCHAR,
                    device VARCHAR,
                    start_ts_utc TIMESTAMP,
                    end_ts_utc TIMESTAMP,
                    duration_s REAL,
                    distance_m REAL,
                    source VARCHAR,
                    imported_at TIMESTAMP DEFAULT now(),
                    metadata_json VARCHAR
                );

                INSERT INTO activities_migrated (
                    id, file_hash, file_name, activity_name, sport, device,
                    start_ts_utc, end_ts_utc, duration_s, distance_m, source,
                    imported_at, metadata_json
                )
                SELECT
                    id,
                    file_hash,
                    file_name,
                    activity_name,
                    sport,
                    device,
                    start_ts_utc,
                    end_ts_utc,
                    CAST(duration_s AS REAL),
                    CAST(distance_m AS REAL),
                    source,
                    imported_at,
                    metadata_json
                FROM activities;

                DROP TABLE activities;
                ALTER TABLE activities_migrated RENAME TO activities;
                "#,
            )?;
            tracing::info!("activities numeric type migration completed");
        }

        let records_needs_migration =
            !column_type_matches(conn, "records", "latitude", "DOUBLE")?
                || !column_type_matches(conn, "records", "longitude", "DOUBLE")?
                || !column_type_matches(conn, "records", "altitude_m", "REAL")?
                || !column_type_matches(conn, "records", "distance_m", "REAL")?
                || !column_type_matches(conn, "records", "speed_m_s", "REAL")?
                || !column_type_matches(conn, "records", "temperature_c", "REAL")?;

        if records_needs_migration {
            tracing::info!("migrating records numeric column types");
            conn.execute_batch(
                r#"
                CREATE TABLE records_migrated (
                    activity_id BIGINT NOT NULL,
                    timestamp_ms BIGINT NOT NULL,
                    latitude DOUBLE,
                    longitude DOUBLE,
                    altitude_m REAL,
                    distance_m REAL,
                    speed_m_s REAL,
                    cadence BIGINT,
                    heart_rate BIGINT,
                    power BIGINT,
                    temperature_c REAL,
                    raw_fields_json VARCHAR
                );

                INSERT INTO records_migrated (
                    activity_id, timestamp_ms, latitude, longitude, altitude_m,
                    distance_m, speed_m_s, cadence, heart_rate, power,
                    temperature_c, raw_fields_json
                )
                SELECT
                    activity_id,
                    timestamp_ms,
                    CAST(latitude AS DOUBLE),
                    CAST(longitude AS DOUBLE),
                    CAST(altitude_m AS REAL),
                    CAST(distance_m AS REAL),
                    CAST(speed_m_s AS REAL),
                    cadence,
                    heart_rate,
                    power,
                    CAST(temperature_c AS REAL),
                    raw_fields_json
                FROM records;

                DROP TABLE records;
                ALTER TABLE records_migrated RENAME TO records;
                "#,
            )?;
            tracing::info!("records numeric type migration completed");
        }

        Ok(())
    }

    pub fn has_user(&self) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM users")?;
        let count: i64 = stmt.query_row([], |r| r.get(0))?;
        Ok(count > 0)
    }

    pub fn create_user(&self, username: &str, password_hash: &str) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute(
                "INSERT INTO users (id, username, password_hash) VALUES (?1, ?2, ?3)",
                params![1_i64, username, password_hash],
            )?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    pub fn get_password_hash(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT password_hash FROM users LIMIT 1")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            return Ok(Some(row.get(0)?));
        }
        Ok(None)
    }

    pub fn insert_session(&self, token: &str, expiry_iso: &str) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, 1, ?2)",
                params![token, expiry_iso],
            )?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    pub fn delete_sessions_for_user(&self, user_id: i64) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    pub fn purge_expired_sessions(&self) -> Result<usize> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let deleted = conn.execute("DELETE FROM sessions WHERE expires_at <= now()", [])?;
        Ok(deleted)
    }

    #[cfg(all(feature = "web", not(feature = "tauri-app")))]
    pub fn session_valid(&self, token: &str) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) FROM sessions WHERE token = ?1 AND expires_at > now()",
        )?;
        let count: i64 = stmt.query_row(params![token], |r| r.get(0))?;
        Ok(count > 0)
    }

    #[cfg(all(feature = "web", not(feature = "tauri-app")))]
    pub fn delete_session(&self, token: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])?;
        Ok(())
    }

    pub fn is_file_imported(&self, file_hash: &str) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM activities WHERE file_hash = ?1")?;
        let count: i64 = stmt.query_row(params![file_hash], |r| r.get(0))?;
        Ok(count > 0)
    }

    pub fn insert_activity(&self, p: ParsedActivity) -> Result<i64> {
        let activity_id: i64;
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            activity_id = conn.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM activities", [], |r| {
                r.get(0)
            })?;

            let duration_s = round_6_to_f32(p.duration_s);
            let distance_m = round_6_to_f32(p.distance_m);

            conn.execute(
                "INSERT INTO activities (id, file_hash, file_name, activity_name, sport, device, start_ts_utc, end_ts_utc, duration_s, distance_m, source, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    activity_id,
                    p.file_hash,
                    p.file_name,
                    p.activity_name,
                    p.sport,
                    p.device,
                    p.start_ts_utc,
                    p.end_ts_utc,
                    duration_s,
                    distance_m,
                    p.source_format,
                    p.metadata_json
                ],
            )?;

            let tx = conn.unchecked_transaction()?;
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO records (activity_id, timestamp_ms, latitude, longitude, altitude_m, distance_m, speed_m_s, cadence, heart_rate, power, temperature_c, raw_fields_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                )?;

                for r in p.records {
                    insert_record(&mut stmt, activity_id, r)?;
                }
            }
            tx.commit()?;
        }

        self.checkpoint_if_wal_exceeds_limit()?;

        Ok(activity_id)
    }

    pub fn list_activities(&self) -> Result<Vec<Activity>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, file_name, activity_name, COALESCE(sport,''), COALESCE(device,''), CAST(start_ts_utc AS VARCHAR), CAST(end_ts_utc AS VARCHAR), CAST(COALESCE(duration_s,0) AS DOUBLE), CAST(COALESCE(distance_m,0) AS DOUBLE)
             FROM activities ORDER BY start_ts_utc DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Activity {
                id: row.get(0)?,
                file_name: row.get(1)?,
                activity_name: row.get(2)?,
                sport: row.get(3)?,
                device: row.get(4)?,
                start_ts_utc: row.get(5)?,
                end_ts_utc: row.get(6)?,
                duration_s: row.get(7)?,
                distance_m: row.get(8)?,
            })
        })?;

        let mut out = Vec::new();
        for item in rows {
            out.push(item?);
        }
        Ok(out)
    }

    pub fn rename_activity(&self, activity_id: i64, name: &str) -> Result<bool> {
        let changed = {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute(
                "UPDATE activities SET activity_name = ?1 WHERE id = ?2",
                params![name, activity_id],
            )?
        };
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(changed > 0)
    }

    pub fn delete_activity(&self, activity_id: i64) -> Result<bool> {
        let changed = {
            let conn = self.conn.lock().expect("db mutex poisoned");
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM records WHERE activity_id = ?1", params![activity_id])?;
            let changed = tx.execute("DELETE FROM activities WHERE id = ?1", params![activity_id])?;
            tx.commit()?;
            changed
        };
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(changed > 0)
    }

    pub fn overview(&self) -> Result<OverviewStats> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT COUNT(*), CAST(COALESCE(SUM(distance_m),0) AS DOUBLE), CAST(COALESCE(SUM(duration_s),0) AS DOUBLE) FROM activities",
        )?;
        stmt.query_row([], |r| {
            Ok(OverviewStats {
                activity_count: r.get(0)?,
                total_distance_m: r.get(1)?,
                total_duration_s: r.get(2)?,
            })
        })
        .map_err(Into::into)
    }

    pub fn records_downsampled(&self, activity_id: i64, resolution_ms: i64) -> Result<Vec<RecordPoint>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let query = r#"
            SELECT
              MIN(timestamp_ms) AS timestamp_ms,
                            CAST(AVG(latitude) AS DOUBLE) AS latitude,
                            CAST(AVG(longitude) AS DOUBLE) AS longitude,
                            CAST(AVG(altitude_m) AS DOUBLE) AS altitude_m,
                            CAST(MAX(distance_m) AS DOUBLE) AS distance_m,
                            CAST(AVG(speed_m_s) AS DOUBLE) AS speed_m_s,
              AVG(cadence) AS cadence,
              AVG(heart_rate) AS heart_rate,
              AVG(power) AS power,
                            CAST(AVG(temperature_c) AS DOUBLE) AS temperature_c
            FROM records
            WHERE activity_id = ?1
            GROUP BY (timestamp_ms / ?2)
            ORDER BY timestamp_ms
        "#;

        let mut stmt = conn.prepare(query)?;
        let rows = stmt.query_map(params![activity_id, resolution_ms.max(1000)], |row| {
            Ok(RecordPoint {
                timestamp_ms: row.get(0)?,
                latitude: row.get(1)?,
                longitude: row.get(2)?,
                altitude_m: row.get(3)?,
                distance_m: row.get(4)?,
                speed_m_s: row.get(5)?,
                cadence: row.get::<_, Option<f64>>(6)?.map(|v| v as i64),
                heart_rate: row.get::<_, Option<f64>>(7)?.map(|v| v as i64),
                power: row.get::<_, Option<f64>>(8)?.map(|v| v as i64),
                temperature_c: row.get(9)?,
            })
        })?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

fn column_type_matches(conn: &Connection, table: &str, column: &str, expected: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info('{}')", table))?;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        let col_type: String = row.get(2)?;
        Ok((name, col_type))
    })?;

    for row in rows {
        let (name, col_type) = row?;
        if name == column {
            return Ok(type_equivalent(&col_type, expected));
        }
    }

    Ok(false)
}

fn type_equivalent(actual: &str, expected: &str) -> bool {
    let a = actual.trim().to_ascii_uppercase();
    let e = expected.trim().to_ascii_uppercase();
    match e.as_str() {
        "REAL" => matches!(a.as_str(), "REAL" | "FLOAT" | "FLOAT4"),
        "DOUBLE" => matches!(a.as_str(), "DOUBLE" | "FLOAT8"),
        _ => a == e,
    }
}

fn insert_record(stmt: &mut duckdb::Statement<'_>, activity_id: i64, r: RecordPoint) -> Result<()> {
    // Keep max available precision for coordinates.
    let latitude = r.latitude;
    let longitude = r.longitude;
    // Keep up to 6 decimals for remaining high-cardinality numeric telemetry fields.
    let altitude_m = r.altitude_m.map(round_6_to_f32);
    let distance_m = r.distance_m.map(round_6_to_f32);
    let speed_m_s = r.speed_m_s.map(round_6_to_f32);
    let temperature_c = r.temperature_c.map(round_6_to_f32);
    let cadence = r.cadence;

    stmt.execute(params![
        activity_id,
        r.timestamp_ms,
        latitude,
        longitude,
        altitude_m,
        distance_m,
        speed_m_s,
        cadence,
        r.heart_rate,
        r.power,
        temperature_c,
        "{}"
    ])?;
    Ok(())
}

fn round_6_to_f32(value: f64) -> f32 {
    (((value as f32) * 1_000_000.0).round()) / 1_000_000.0
}

impl Database {
    pub fn get_activity_hash(&self, activity_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT file_hash FROM activities WHERE id = ?1")?;
        let mut rows = stmt.query(params![activity_id])?;
        if let Some(row) = rows.next()? {
            return Ok(Some(row.get(0)?));
        }
        Ok(None)
    }

    pub fn add_blacklisted_hash(&self, file_hash: &str) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute(
                "DELETE FROM file_hash_blacklist WHERE file_hash = ?1",
                params![file_hash],
            )?;
            conn.execute(
                "INSERT INTO file_hash_blacklist (file_hash) VALUES (?1)",
                params![file_hash],
            )?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    pub fn remove_blacklisted_hash(&self, file_hash: &str) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            conn.execute(
                "DELETE FROM file_hash_blacklist WHERE file_hash = ?1",
                params![file_hash],
            )?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    pub fn is_hash_blacklisted(&self, file_hash: &str) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) FROM file_hash_blacklist WHERE file_hash = ?1",
        )?;
        let count: i64 = stmt.query_row(params![file_hash], |r| r.get(0))?;
        Ok(count > 0)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            return Ok(Some(row.get(0)?));
        }
        Ok(None)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        {
            let conn = self.conn.lock().expect("db mutex poisoned");
            // DuckDB doesn't support INSERT OR REPLACE; delete then insert
            conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        self.checkpoint_if_wal_exceeds_limit()?;
        Ok(())
    }

    #[cfg(all(feature = "web", not(feature = "tauri-app")))]
    pub fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
