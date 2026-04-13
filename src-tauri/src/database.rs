use std::sync::Mutex;

use anyhow::{Context, Result};
use duckdb::{params, Connection};

use crate::models::{Activity, OverviewStats, ParsedActivity, RecordPoint};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path).context("failed to open DuckDB")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
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

        // Best-effort schema tightening for existing databases.
        let _ = conn.execute("ALTER TABLE activities ALTER COLUMN duration_s TYPE REAL", []);
        let _ = conn.execute("ALTER TABLE activities ALTER COLUMN distance_m TYPE REAL", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN latitude TYPE DOUBLE", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN longitude TYPE DOUBLE", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN altitude_m TYPE REAL", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN distance_m TYPE REAL", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN speed_m_s TYPE REAL", []);
        let _ = conn.execute("ALTER TABLE records ALTER COLUMN temperature_c TYPE REAL", []);
        Ok(())
    }

    pub fn has_user(&self) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM users")?;
        let count: i64 = stmt.query_row([], |r| r.get(0))?;
        Ok(count > 0)
    }

    pub fn create_user(&self, username: &str, password_hash: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO users (id, username, password_hash) VALUES (?1, ?2, ?3)",
            params![1_i64, username, password_hash],
        )?;
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
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, 1, ?2)",
            params![token, expiry_iso],
        )?;
        Ok(())
    }

    pub fn delete_sessions_for_user(&self, user_id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
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
        let conn = self.conn.lock().expect("db mutex poisoned");
        let activity_id: i64 = conn.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM activities", [], |r| {
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

        Ok(activity_id)
    }

    pub fn list_activities(&self) -> Result<Vec<Activity>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, file_name, activity_name, COALESCE(sport,''), COALESCE(device,''), CAST(start_ts_utc AS VARCHAR), CAST(end_ts_utc AS VARCHAR), COALESCE(duration_s,0), COALESCE(distance_m,0)
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
        let conn = self.conn.lock().expect("db mutex poisoned");
        let changed = conn.execute(
            "UPDATE activities SET activity_name = ?1 WHERE id = ?2",
            params![name, activity_id],
        )?;
        Ok(changed > 0)
    }

    pub fn delete_activity(&self, activity_id: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM records WHERE activity_id = ?1", params![activity_id])?;
        let changed = tx.execute("DELETE FROM activities WHERE id = ?1", params![activity_id])?;
        tx.commit()?;
        Ok(changed > 0)
    }

    pub fn overview(&self) -> Result<OverviewStats> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT COUNT(*), COALESCE(SUM(distance_m),0), COALESCE(SUM(duration_s),0) FROM activities",
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
              AVG(latitude) AS latitude,
              AVG(longitude) AS longitude,
              AVG(altitude_m) AS altitude_m,
              MAX(distance_m) AS distance_m,
              AVG(speed_m_s) AS speed_m_s,
              AVG(cadence) AS cadence,
              AVG(heart_rate) AS heart_rate,
              AVG(power) AS power,
              AVG(temperature_c) AS temperature_c
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
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "DELETE FROM file_hash_blacklist WHERE file_hash = ?1",
            params![file_hash],
        )?;
        conn.execute(
            "INSERT INTO file_hash_blacklist (file_hash) VALUES (?1)",
            params![file_hash],
        )?;
        Ok(())
    }

    pub fn remove_blacklisted_hash(&self, file_hash: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "DELETE FROM file_hash_blacklist WHERE file_hash = ?1",
            params![file_hash],
        )?;
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
        let conn = self.conn.lock().expect("db mutex poisoned");
        // DuckDB doesn't support INSERT OR REPLACE; delete then insert
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    #[cfg(all(feature = "web", not(feature = "tauri-app")))]
    pub fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
