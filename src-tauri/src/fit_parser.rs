use std::path::Path;

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

fn parse_timestamp_ms(raw: &str) -> Option<i64> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.timestamp_millis());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(dt.and_utc().timestamp_millis());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.and_utc().timestamp_millis());
    }
    None
}

fn strip_known_extension(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".fit") || lower.ends_with(".tcx") || lower.ends_with(".gpx") {
        let cut = file_name.rfind('.').unwrap_or(file_name.len());
        return file_name[..cut].to_string();
    }
    file_name.to_string()
}

fn file_hash_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|n| n.is_element() && n.tag_name().name() == name)
        .and_then(|n| n.text())
        .map(|s| s.trim().to_string())
}

fn child_f64(node: roxmltree::Node<'_, '_>, name: &str) -> Option<f64> {
    child_text(node, name).and_then(|s| s.parse::<f64>().ok())
}

fn child_i64(node: roxmltree::Node<'_, '_>, name: &str) -> Option<i64> {
    child_text(node, name).and_then(|s| s.parse::<i64>().ok())
}

fn child_node<'a>(node: roxmltree::Node<'a, 'a>, name: &str) -> Option<roxmltree::Node<'a, 'a>> {
    node.children()
        .find(|n| n.is_element() && n.tag_name().name() == name)
}

fn title_case_sport(sport: &str) -> String {
    if sport.is_empty() {
        return "Activity".to_string();
    }
    let mut chars = sport.chars();
    let Some(first) = chars.next() else {
        return "Activity".to_string();
    };
    first.to_uppercase().collect::<String>() + chars.as_str()
}

fn build_activity_name(file_name: &str, sport: &str, points: &[RecordPoint]) -> String {
    let fallback = strip_known_extension(file_name);
    let sport_label = title_case_sport(sport);

    if let Some(pos) = points.iter().find(|p| p.latitude.is_some() && p.longitude.is_some()) {
        let geocoder = reverse_geocoder::ReverseGeocoder::new();
        let result = geocoder.search((pos.latitude.unwrap(), pos.longitude.unwrap()));
        let record = result.record;

        let mut loc_parts = Vec::new();
        if !record.name.is_empty() {
            loc_parts.push(record.name.as_str());
        }
        if !record.admin1.is_empty() {
            loc_parts.push(record.admin1.as_str());
        }
        let loc = loc_parts.join(", ");
        if !loc.is_empty() {
            return format!("{} — {}", loc, sport_label);
        }
    }

    fallback
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6_371_000.0_f64;
    let to_rad = std::f64::consts::PI / 180.0;
    let dlat = (lat2 - lat1) * to_rad;
    let dlon = (lon2 - lon1) * to_rad;
    let lat1r = lat1 * to_rad;
    let lat2r = lat2 * to_rad;
    let a = (dlat / 2.0).sin().powi(2) + lat1r.cos() * lat2r.cos() * (dlon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    r * c
}

fn derive_distance_if_missing(points: &mut [RecordPoint]) {
    let has_distance = points.iter().any(|p| p.distance_m.is_some());
    if has_distance {
        return;
    }

    let mut cumulative = 0.0;
    for i in 0..points.len() {
        if i > 0 {
            if let (Some(lat1), Some(lon1), Some(lat2), Some(lon2)) = (
                points[i - 1].latitude,
                points[i - 1].longitude,
                points[i].latitude,
                points[i].longitude,
            ) {
                cumulative += haversine_m(lat1, lon1, lat2, lon2);
            }
        }
        points[i].distance_m = Some(cumulative);
    }
}

fn derive_speed_if_missing(points: &mut [RecordPoint]) {
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
}

fn total_distance_m(points: &[RecordPoint]) -> f64 {
    points
        .iter()
        .filter_map(|p| p.distance_m)
        .max_by(|a, b| a.total_cmp(b))
        .unwrap_or(0.0)
}

pub fn parse_activity_bytes(file_name: &str, bytes: &[u8]) -> Result<ParsedActivity> {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "fit" => parse_fit_bytes(file_name, bytes),
        "tcx" => parse_tcx_bytes(file_name, bytes),
        "gpx" => parse_gpx_bytes(file_name, bytes),
        _ => {
            let text = std::str::from_utf8(bytes).unwrap_or("");
            if text.contains("<TrainingCenterDatabase") {
                parse_tcx_bytes(file_name, bytes)
            } else if text.contains("<gpx") {
                parse_gpx_bytes(file_name, bytes)
            } else {
                Err(anyhow!(
                    "unsupported file extension; expected .fit, .tcx, or .gpx"
                ))
            }
        }
    }
}

fn parse_fit_bytes(file_name: &str, bytes: &[u8]) -> Result<ParsedActivity> {
    let file_hash = file_hash_hex(bytes);

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
                    "position_lat" => latitude = value_f64(field.value()).map(to_degrees_if_semicircles),
                    "position_long" => longitude = value_f64(field.value()).map(to_degrees_if_semicircles),
                    "altitude" | "enhanced_altitude" => {
                        let v = value_f64(field.value());
                        if field.name() == "enhanced_altitude" || altitude_m.is_none() {
                            altitude_m = v;
                        }
                    }
                    "distance" => distance_m = value_f64(field.value()),
                    "speed" | "enhanced_speed" => {
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

    derive_distance_if_missing(&mut points);
    derive_speed_if_missing(&mut points);

    let duration_s = ((end_ts - start_ts).max(0) as f64) / 1000.0;
    let distance_m = total_distance_m(&points);

    let metadata_json = serde_json::json!({
        "record_count": points.len(),
        "device": device,
        "sport": sport,
        "source_format": "fit"
    })
    .to_string();

    let activity_name = build_activity_name(file_name, &sport, &points);

    Ok(ParsedActivity {
        file_name: file_name.to_string(),
        source_format: "fit".to_string(),
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

fn parse_tcx_bytes(file_name: &str, bytes: &[u8]) -> Result<ParsedActivity> {
    let file_hash = file_hash_hex(bytes);
    let xml = std::str::from_utf8(bytes).context("TCX is not valid UTF-8")?;
    let doc = roxmltree::Document::parse(xml).context("failed to parse TCX XML")?;

    let activity_node = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Activity")
        .ok_or_else(|| anyhow!("TCX missing Activity node"))?;

    let sport = activity_node
        .attribute("Sport")
        .unwrap_or("unknown")
        .to_lowercase();

    let mut device = String::new();
    if let Some(creator) = activity_node
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Creator")
    {
        device = child_text(creator, "Name")
            .or_else(|| child_text(creator, "ProductID"))
            .unwrap_or_default();
    }

    let mut points = Vec::new();
    let mut min_ts: Option<i64> = None;
    let mut max_ts: Option<i64> = None;

    for tp in activity_node
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "Trackpoint")
    {
        let ts = child_text(tp, "Time")
            .as_deref()
            .and_then(parse_timestamp_ms);
        let Some(timestamp_ms) = ts else {
            continue;
        };

        let position = child_node(tp, "Position");
        let latitude = position.and_then(|p| child_f64(p, "LatitudeDegrees"));
        let longitude = position.and_then(|p| child_f64(p, "LongitudeDegrees"));

        let mut speed_m_s = None;
        let mut power = None;
        let mut cadence = child_i64(tp, "Cadence");
        let mut temperature_c = None;

        if let Some(ext) = child_node(tp, "Extensions") {
            for n in ext.descendants().filter(|x| x.is_element()) {
                let name = n.tag_name().name().to_lowercase();
                let val = n.text().map(str::trim).unwrap_or("");
                if val.is_empty() {
                    continue;
                }
                match name.as_str() {
                    "speed" => {
                        if speed_m_s.is_none() {
                            speed_m_s = val.parse::<f64>().ok();
                        }
                    }
                    "watts" | "power" => {
                        if power.is_none() {
                            power = val.parse::<i64>().ok();
                        }
                    }
                    "run_cadence" | "cadence" => {
                        if cadence.is_none() {
                            cadence = val.parse::<i64>().ok();
                        }
                    }
                    "temperature" => {
                        if temperature_c.is_none() {
                            temperature_c = val.parse::<f64>().ok();
                        }
                    }
                    _ => {}
                }
            }
        }

        min_ts = Some(min_ts.map_or(timestamp_ms, |m| m.min(timestamp_ms)));
        max_ts = Some(max_ts.map_or(timestamp_ms, |m| m.max(timestamp_ms)));
        points.push(RecordPoint {
            timestamp_ms,
            latitude,
            longitude,
            altitude_m: child_f64(tp, "AltitudeMeters"),
            distance_m: child_f64(tp, "DistanceMeters"),
            speed_m_s,
            cadence,
            heart_rate: child_node(tp, "HeartRateBpm").and_then(|hr| child_i64(hr, "Value")),
            power,
            temperature_c,
        });
    }

    let start_ts = min_ts.ok_or_else(|| anyhow!("TCX file had no timestamped trackpoints"))?;
    let end_ts = max_ts.unwrap_or(start_ts);

    derive_distance_if_missing(&mut points);
    derive_speed_if_missing(&mut points);

    let duration_s = ((end_ts - start_ts).max(0) as f64) / 1000.0;
    let distance_m = total_distance_m(&points);

    let metadata_json = serde_json::json!({
        "record_count": points.len(),
        "device": device,
        "sport": sport,
        "source_format": "tcx"
    })
    .to_string();

    let activity_name = build_activity_name(file_name, &sport, &points);

    Ok(ParsedActivity {
        file_name: file_name.to_string(),
        source_format: "tcx".to_string(),
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

fn parse_gpx_bytes(file_name: &str, bytes: &[u8]) -> Result<ParsedActivity> {
    let file_hash = file_hash_hex(bytes);
    let xml = std::str::from_utf8(bytes).context("GPX is not valid UTF-8")?;
    let doc = roxmltree::Document::parse(xml).context("failed to parse GPX XML")?;

    let root = doc.root_element();
    if root.tag_name().name() != "gpx" {
        return Err(anyhow!("not a GPX file"));
    }

    let sport = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "type")
        .and_then(|n| n.text())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let device = root
        .attribute("creator")
        .map(|s| s.to_string())
        .unwrap_or_default();

    let mut points = Vec::new();
    let mut min_ts: Option<i64> = None;
    let mut max_ts: Option<i64> = None;

    for tp in doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "trkpt")
    {
        let ts = child_text(tp, "time").as_deref().and_then(parse_timestamp_ms);
        let Some(timestamp_ms) = ts else {
            continue;
        };

        let latitude = tp.attribute("lat").and_then(|v| v.parse::<f64>().ok());
        let longitude = tp.attribute("lon").and_then(|v| v.parse::<f64>().ok());

        let mut heart_rate = None;
        let mut cadence = None;
        let mut power = None;
        let mut temperature_c = None;
        let mut speed_m_s = None;
        let mut distance_m = None;

        if let Some(ext) = child_node(tp, "extensions") {
            for n in ext.descendants().filter(|x| x.is_element()) {
                let name = n.tag_name().name().to_lowercase();
                let val = n.text().map(str::trim).unwrap_or("");
                if val.is_empty() {
                    continue;
                }
                match name.as_str() {
                    "hr" => {
                        if heart_rate.is_none() {
                            heart_rate = val.parse::<i64>().ok();
                        }
                    }
                    "cad" | "cadence" => {
                        if cadence.is_none() {
                            cadence = val.parse::<i64>().ok();
                        }
                    }
                    "power" | "watts" => {
                        if power.is_none() {
                            power = val.parse::<i64>().ok();
                        }
                    }
                    "atemp" | "temp" | "temperature" => {
                        if temperature_c.is_none() {
                            temperature_c = val.parse::<f64>().ok();
                        }
                    }
                    "speed" => {
                        if speed_m_s.is_none() {
                            speed_m_s = val.parse::<f64>().ok();
                        }
                    }
                    "distance" => {
                        if distance_m.is_none() {
                            distance_m = val.parse::<f64>().ok();
                        }
                    }
                    _ => {}
                }
            }
        }

        min_ts = Some(min_ts.map_or(timestamp_ms, |m| m.min(timestamp_ms)));
        max_ts = Some(max_ts.map_or(timestamp_ms, |m| m.max(timestamp_ms)));
        points.push(RecordPoint {
            timestamp_ms,
            latitude,
            longitude,
            altitude_m: child_f64(tp, "ele"),
            distance_m,
            speed_m_s,
            cadence,
            heart_rate,
            power,
            temperature_c,
        });
    }

    let start_ts = min_ts.ok_or_else(|| anyhow!("GPX file had no timestamped trackpoints"))?;
    let end_ts = max_ts.unwrap_or(start_ts);

    derive_distance_if_missing(&mut points);
    derive_speed_if_missing(&mut points);

    let duration_s = ((end_ts - start_ts).max(0) as f64) / 1000.0;
    let distance_m = total_distance_m(&points);

    let metadata_json = serde_json::json!({
        "record_count": points.len(),
        "device": device,
        "sport": sport,
        "source_format": "gpx"
    })
    .to_string();

    let activity_name = build_activity_name(file_name, &sport, &points);

    Ok(ParsedActivity {
        file_name: file_name.to_string(),
        source_format: "gpx".to_string(),
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
