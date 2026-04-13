use anyhow::{anyhow, Context, Result};
use fitparser::{profile::MesgNum, Value};
use sha2::{Digest, Sha256};

use crate::models::{ParsedActivity, RecordPoint};

fn value_f64(v: &Value) -> Option<f64> {
    match v {
        Value::SInt8(x) => Some(*x as f64),
        Value::UInt8(x) => Some(*x as f64),
        Value::SInt16(x) => Some(*x as f64),
        Value::UInt16(x) => Some(*x as f64),
        Value::SInt32(x) => Some(*x as f64),
        Value::UInt32(x) => Some(*x as f64),
        Value::SInt64(x) => Some(*x as f64),
        Value::UInt64(x) => Some(*x as f64),
        Value::Float32(x) => Some(*x as f64),
        Value::Float64(x) => Some(*x),
        _ => None,
    }
}

fn value_i64(v: &Value) -> Option<i64> {
    value_f64(v).map(|n| n as i64)
}

fn value_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn to_degrees_if_semicircles(v: f64) -> f64 {
    if v.abs() > 180.0 {
        v * (180.0 / 2_f64.powi(31))
    } else {
        v
    }
}

pub fn parse_fit_bytes(file_name: &str, bytes: &[u8]) -> Result<ParsedActivity> {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let file_hash = hex::encode(hasher.finalize());

    let mut reader = std::io::Cursor::new(bytes);
    let records = fitparser::from_reader(&mut reader).context("failed to parse FIT")?;

    let mut points: Vec<RecordPoint> = Vec::new();
    let mut sport = String::from("unknown");
    let mut device = String::new();

    let mut min_ts: Option<i64> = None;
    let mut max_ts: Option<i64> = None;

    for rec in records {
        if rec.kind() == MesgNum::Record {
            let mut timestamp_ms: Option<i64> = None;
            let mut latitude = None;
            let mut longitude = None;
            let mut altitude_m = None;
            let mut distance_m = None;
            let mut speed_m_s = None;
            let mut cadence = None;
            let mut heart_rate = None;
            let mut power = None;
            let mut temperature_c = None;

            for field in rec.fields() {
                match field.name() {
                    "timestamp" => {
                        if let Value::Timestamp(dt) = field.value() {
                            timestamp_ms = Some(dt.timestamp_millis());
                        }
                    }
                    "position_lat" => {
                        latitude = value_f64(field.value()).map(to_degrees_if_semicircles);
                    }
                    "position_long" => {
                        longitude = value_f64(field.value()).map(to_degrees_if_semicircles);
                    }
                    "altitude" | "enhanced_altitude" => {
                        // Prefer enhanced altitude when present in modern FIT files.
                        let v = value_f64(field.value());
                        if field.name() == "enhanced_altitude" || altitude_m.is_none() {
                            altitude_m = v;
                        }
                    }
                    "distance" => distance_m = value_f64(field.value()),
                    "speed" | "enhanced_speed" => {
                        // Prefer enhanced speed when present.
                        let v = value_f64(field.value());
                        if field.name() == "enhanced_speed" || speed_m_s.is_none() {
                            speed_m_s = v;
                        }
                    }
                    "cadence" => cadence = value_i64(field.value()),
                    "heart_rate" => heart_rate = value_i64(field.value()),
                    "power" => power = value_i64(field.value()),
                    "temperature" => temperature_c = value_f64(field.value()),
                    _ => {}
                }
            }

            if let Some(ts) = timestamp_ms {
                min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
                max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));
                points.push(RecordPoint {
                    timestamp_ms: ts,
                    latitude,
                    longitude,
                    altitude_m,
                    distance_m,
                    speed_m_s,
                    cadence,
                    heart_rate,
                    power,
                    temperature_c,
                });
            }
        } else if rec.kind() == MesgNum::Session {
            for field in rec.fields() {
                if field.name() == "sport" {
                    sport = value_string(field.value()).to_lowercase();
                }
            }
        } else if rec.kind() == MesgNum::DeviceInfo {
            for field in rec.fields() {
                if field.name() == "product_name" {
                    device = value_string(field.value());
                }
            }
        }
    }

    let start_ts = min_ts.ok_or_else(|| anyhow!("FIT file had no timestamped records"))?;
    let end_ts = max_ts.unwrap_or(start_ts);
    let duration_s = ((end_ts - start_ts).max(0) as f64) / 1000.0;
    let distance_m = points
        .iter()
        .filter_map(|p| p.distance_m)
        .max_by(|a, b| a.total_cmp(b))
        .unwrap_or(0.0);

    // Fallback: derive missing speed from distance deltas where FIT records omit speed.
    for i in 1..points.len() {
        if points[i].speed_m_s.is_some() {
            continue;
        }
        let dt_s = (points[i].timestamp_ms - points[i - 1].timestamp_ms) as f64 / 1000.0;
        let dd_m = match (points[i].distance_m, points[i - 1].distance_m) {
            (Some(curr), Some(prev)) => curr - prev,
            _ => 0.0,
        };
        if dt_s > 0.0 && dd_m >= 0.0 {
            points[i].speed_m_s = Some(dd_m / dt_s);
        }
    }

    let metadata_json = serde_json::json!({
        "record_count": points.len(),
        "device": device,
        "sport": sport
    })
    .to_string();

    let activity_name;
    let mut display_sport = sport.clone();
    if let Some(first) = display_sport.chars().next() {
        display_sport = first.to_uppercase().collect::<String>() + &display_sport[first.len_utf8()..];
    }
    if display_sport.is_empty() {
        display_sport = "Activity".to_string();
    }

    if let Some(pos) = points.iter().find(|p| p.latitude.is_some() && p.longitude.is_some()) {
        let lat = pos.latitude.unwrap();
        let lon = pos.longitude.unwrap();
        let geocoder = reverse_geocoder::ReverseGeocoder::new();
        let result = geocoder.search((lat, lon));
        let record = result.record;
        
        let mut loc_parts = Vec::new();
        if !record.name.is_empty() {
            loc_parts.push(record.name.as_str());
        }
        if !record.admin1.is_empty() {
            loc_parts.push(record.admin1.as_str());
        }
        let loc_str = loc_parts.join(", ");
        
        if loc_str.is_empty() {
            activity_name = file_name.trim_end_matches(".fit").to_string();
        } else {
            activity_name = format!("{} — {}", loc_str, display_sport);
        }
    } else {
        activity_name = file_name.trim_end_matches(".fit").to_string();
    }

    Ok(ParsedActivity {
        file_name: file_name.to_string(),
        activity_name,
        sport,
        device,
        start_ts_utc: chrono::DateTime::from_timestamp_millis(start_ts)
            .ok_or_else(|| anyhow!("invalid start timestamp"))?
            .to_rfc3339(),
        end_ts_utc: chrono::DateTime::from_timestamp_millis(end_ts)
            .ok_or_else(|| anyhow!("invalid end timestamp"))?
            .to_rfc3339(),
        duration_s,
        distance_m,
        file_hash,
        records: points,
        metadata_json,
    })
}
