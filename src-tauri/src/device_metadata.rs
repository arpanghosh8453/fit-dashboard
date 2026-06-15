use std::collections::{BTreeMap, BTreeSet};

use fitparser::profile::field_types::{
    AntNetwork, AntplusDeviceType, BleDeviceType, FaveroProduct, GarminProduct, LocalDeviceType,
    Manufacturer, SourceType,
};
use serde::Serialize;
use serde_json::Value as JsonValue;

#[derive(Clone, Debug, Default)]
pub struct RawFileId {
    pub manufacturer_value: Option<String>,
    pub product_field: Option<String>,
    pub product_value: Option<String>,
    pub serial_number: Option<i64>,
    pub time_created_ms: Option<i64>,
}

#[derive(Clone, Debug, Default)]
pub struct RawDeviceType {
    pub field: String,
    pub value: String,
    pub code: Option<i64>,
}

#[derive(Clone, Debug, Default)]
pub struct RawDeviceInfo {
    pub timestamp_ms: Option<i64>,
    pub device_index_value: Option<String>,
    pub device_index_code: Option<i64>,
    pub source_type_value: Option<String>,
    pub source_type_code: Option<i64>,
    pub device_types: Vec<RawDeviceType>,
    pub manufacturer_value: Option<String>,
    pub product_field: Option<String>,
    pub product_value: Option<String>,
    pub product_name: Option<String>,
    pub serial_number: Option<i64>,
    pub software_version: Option<String>,
    pub hardware_version: Option<i64>,
    pub battery_status: Option<String>,
    pub battery_level: Option<f64>,
    pub battery_voltage: Option<f64>,
    pub ant_device_number: Option<i64>,
    pub ant_transmission_type: Option<i64>,
    pub ant_network_value: Option<String>,
    pub ant_network_code: Option<i64>,
    pub descriptor: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CodeNameLabel {
    pub code: Option<i64>,
    pub name: Option<String>,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ProductMetadata {
    pub field: Option<String>,
    pub code: Option<i64>,
    pub name: Option<String>,
    pub label: Option<String>,
    pub lookup_source: String,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct DeviceIdentifiers {
    pub ant_device_number: Option<i64>,
    pub ant_transmission_type: Option<i64>,
    pub ant_network: Option<String>,
    pub descriptor: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct DeviceMetadata {
    pub role: String,
    pub device_indices: Vec<JsonValue>,
    pub source_type: CodeNameLabel,
    pub device_types: Vec<CodeNameLabel>,
    pub manufacturer: CodeNameLabel,
    pub product: ProductMetadata,
    pub serial_number: Option<i64>,
    pub software_version: Option<String>,
    pub hardware_version: Option<i64>,
    pub battery_status: Option<String>,
    pub battery_level: Option<f64>,
    pub battery_voltage: Option<f64>,
    pub identifiers: DeviceIdentifiers,
    pub first_seen_utc: Option<String>,
    pub last_seen_utc: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct DecodedFileIdMetadata {
    pub manufacturer: CodeNameLabel,
    pub product: ProductMetadata,
    pub serial_number: Option<i64>,
    pub time_created_utc: Option<String>,
}

trait FitEnumCode {
    fn fit_code(self) -> i64;
}

impl FitEnumCode for Manufacturer {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for GarminProduct {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for FaveroProduct {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for SourceType {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for AntplusDeviceType {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for BleDeviceType {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for LocalDeviceType {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

impl FitEnumCode for AntNetwork {
    fn fit_code(self) -> i64 {
        self.as_i64()
    }
}

fn reverse_fit_enum<T>(name: &str) -> Option<i64>
where
    for<'a> T: From<&'a str>,
    T: FitEnumCode + Copy + ToString,
{
    let parsed = T::from(name);
    if parsed.to_string() == name {
        Some(parsed.fit_code())
    } else {
        None
    }
}

fn enum_name_from_code<T>(code: i64) -> Option<String>
where
    T: From<i64> + FitEnumCode + Copy + ToString,
{
    let parsed = T::from(code);
    let name = parsed.to_string();
    if parsed.fit_code() == code && name != code.to_string() && !name.starts_with("unknown_variant_") {
        Some(name)
    } else {
        None
    }
}

fn clean_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().all(|c| c.is_ascii_digit())
        || trimmed.to_lowercase().starts_with("unknown_variant_")
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn numeric_code(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

fn humanize_identifier(name: &str) -> String {
    name.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "ant" => "ANT".to_string(),
            "antfs" => "ANT-FS".to_string(),
            "antplus" => "ANT+".to_string(),
            "ble" => "BLE".to_string(),
            "bt" => "BT".to_string(),
            "gps" => "GPS".to_string(),
            "gnss" => "GNSS".to_string(),
            "glonass" => "GLONASS".to_string(),
            "hr" => "HR".to_string(),
            "hrm" => "HRM".to_string(),
            "ohr" => "OHR".to_string(),
            "whr" => "WHR".to_string(),
            "fr" => "FR".to_string(),
            "ut" => "UT".to_string(),
            "duo" => "Duo".to_string(),
            "uno" => "Uno".to_string(),
            other => {
                let mut chars = other.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn manufacturer_label(name: Option<&str>) -> Option<String> {
    name.map(|value| match value {
        "favero_electronics" => "Favero".to_string(),
        "wahoo_fitness" => "Wahoo".to_string(),
        "sram" => "SRAM".to_string(),
        other => humanize_identifier(other),
    })
}

fn forerunner_label(name: &str) -> Option<String> {
    let suffix = name.strip_prefix("fr")?;
    let mut parts = suffix.split('_');
    let model_part = parts.next()?;
    let (model, has_music_suffix) = model_part
        .strip_suffix('m')
        .filter(|base| !base.is_empty() && base.chars().all(|c| c.is_ascii_digit()))
        .map(|base| (base, true))
        .unwrap_or((model_part, false));

    if model.is_empty() || !model.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    let mut model_suffix = String::new();
    let mut descriptors: Vec<String> = Vec::new();
    if has_music_suffix {
        descriptors.push("Music".to_string());
    }

    for part in parts {
        let descriptor = match part {
            "small" | "s" => {
                model_suffix.push('S');
                None
            }
            "large" => None,
            "m" | "music" => Some("Music".to_string()),
            "lte" => Some("LTE".to_string()),
            "asia" => Some("Asia".to_string()),
            "apac" => Some("APAC".to_string()),
            "japan" => Some("Japan".to_string()),
            "korea" => Some("Korea".to_string()),
            "china" => Some("China".to_string()),
            "sea" => Some("SEA".to_string()),
            other => Some(humanize_identifier(other)),
        };
        if let Some(descriptor) = descriptor {
            if !descriptors.contains(&descriptor) {
                descriptors.push(descriptor);
            }
        }
    }

    let suffix = if descriptors.is_empty() {
        String::new()
    } else {
        format!(" {}", descriptors.join(" "))
    };
    Some(format!("Forerunner {model}{model_suffix}{suffix}"))
}

fn product_label(name: Option<&str>) -> Option<String> {
    name.map(|value| match value {
        "edge_1040" => "Edge 1040".to_string(),
        "hrm_200" => "HRM 200".to_string(),
        "assioma_duo" => "Assioma Duo".to_string(),
        "assioma_uno" => "Assioma Uno".to_string(),
        other => forerunner_label(other).unwrap_or_else(|| humanize_identifier(other)),
    })
}

fn source_type_label(name: Option<&str>) -> Option<String> {
    name.map(|value| match value {
        "ant" => "ANT".to_string(),
        "antplus" => "ANT+".to_string(),
        "bluetooth" => "Bluetooth".to_string(),
        "bluetooth_low_energy" => "Bluetooth Low Energy".to_string(),
        "wifi" => "Wi-Fi".to_string(),
        "local" => "Local".to_string(),
        other => humanize_identifier(other),
    })
}

fn device_type_label(name: Option<&str>) -> Option<String> {
    name.map(|value| match value {
        "heart_rate" => "Heart Rate".to_string(),
        "bike_power" => "Power Meter".to_string(),
        "bike_speed_cadence" => "Speed/Cadence Sensor".to_string(),
        "bike_speed" => "Speed Sensor".to_string(),
        "bike_cadence" => "Cadence Sensor".to_string(),
        "bike_light_main" | "bike_light_shared" => "Bike Light".to_string(),
        "bike_radar" => "Bike Radar".to_string(),
        "gps" => "GPS".to_string(),
        "gnss" => "GNSS".to_string(),
        "barometer" => "Barometer".to_string(),
        other => humanize_identifier(other),
    })
}

fn utc_from_millis(timestamp_ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(timestamp_ms).map(|dt| dt.to_rfc3339())
}

pub fn resolve_manufacturer(raw: Option<&str>) -> CodeNameLabel {
    let code = raw.and_then(numeric_code).or_else(|| {
        raw.and_then(clean_name)
            .as_deref()
            .and_then(reverse_fit_enum::<Manufacturer>)
    });
    let name = raw
        .and_then(clean_name)
        .or_else(|| code.and_then(enum_name_from_code::<Manufacturer>));
    let label = manufacturer_label(name.as_deref());
    CodeNameLabel { code, name, label }
}

fn overlay_product(
    manufacturer_name: Option<&str>,
    field: Option<&str>,
    code: Option<i64>,
) -> Option<(&'static str, &'static str)> {
    match (manufacturer_name, field, code) {
        (Some("garmin"), Some("garmin_product" | "product"), Some(4606)) => {
            Some(("hrm_200", "HRM 200"))
        }
        _ => None,
    }
}

pub fn resolve_product(
    field: Option<&str>,
    raw: Option<&str>,
    manufacturer: &CodeNameLabel,
) -> ProductMetadata {
    let field = field.map(str::to_string);
    let field_name = field.as_deref();
    let raw_name = raw.and_then(clean_name);
    let code = raw
        .and_then(numeric_code)
        .or_else(|| match field_name {
            Some("garmin_product") => raw_name.as_deref().and_then(reverse_fit_enum::<GarminProduct>),
            Some("favero_product") => raw_name.as_deref().and_then(reverse_fit_enum::<FaveroProduct>),
            Some("product") if manufacturer.name.as_deref() == Some("garmin") => {
                raw_name.as_deref().and_then(reverse_fit_enum::<GarminProduct>)
            }
            Some("product") if manufacturer.name.as_deref() == Some("favero_electronics") => {
                raw_name.as_deref().and_then(reverse_fit_enum::<FaveroProduct>)
            }
            _ => None,
        });

    if let Some((name, label)) = overlay_product(manufacturer.name.as_deref(), field_name, code) {
        return ProductMetadata {
            field,
            code,
            name: Some(name.to_string()),
            label: Some(label.to_string()),
            lookup_source: "app_overlay".to_string(),
        };
    }

    let name = raw_name.or_else(|| match field_name {
        Some("garmin_product") => code.and_then(enum_name_from_code::<GarminProduct>),
        Some("favero_product") => code.and_then(enum_name_from_code::<FaveroProduct>),
        Some("product") if manufacturer.name.as_deref() == Some("garmin") => {
            code.and_then(enum_name_from_code::<GarminProduct>)
        }
        Some("product") if manufacturer.name.as_deref() == Some("favero_electronics") => {
            code.and_then(enum_name_from_code::<FaveroProduct>)
        }
        _ => None,
    });
    let lookup_source = if name.is_some() && code.is_some() {
        "fit_profile"
    } else {
        "raw"
    };
    let label = product_label(name.as_deref());
    ProductMetadata {
        field,
        code,
        name,
        label,
        lookup_source: lookup_source.to_string(),
    }
}

fn resolve_source_type(raw: Option<&str>, raw_code: Option<i64>) -> CodeNameLabel {
    let code = raw_code.or_else(|| {
        raw.and_then(clean_name)
            .as_deref()
            .and_then(reverse_fit_enum::<SourceType>)
    });
    let name = raw
        .and_then(clean_name)
        .or_else(|| code.and_then(enum_name_from_code::<SourceType>));
    let label = source_type_label(name.as_deref());
    CodeNameLabel { code, name, label }
}

fn resolve_ant_network(raw: Option<&str>, raw_code: Option<i64>) -> Option<String> {
    raw.and_then(clean_name).or_else(|| {
        raw_code.and_then(enum_name_from_code::<AntNetwork>)
    })
}

fn resolve_device_type(raw_type: &RawDeviceType) -> CodeNameLabel {
    let raw_name = clean_name(&raw_type.value);
    let code = raw_type.code.or_else(|| match raw_type.field.as_str() {
        "antplus_device_type" => raw_name.as_deref().and_then(reverse_fit_enum::<AntplusDeviceType>),
        "ble_device_type" => raw_name.as_deref().and_then(reverse_fit_enum::<BleDeviceType>),
        "local_device_type" => raw_name.as_deref().and_then(reverse_fit_enum::<LocalDeviceType>),
        _ => numeric_code(&raw_type.value),
    });
    let name = raw_name.or_else(|| match raw_type.field.as_str() {
        "antplus_device_type" => code.and_then(enum_name_from_code::<AntplusDeviceType>),
        "ble_device_type" => code.and_then(enum_name_from_code::<BleDeviceType>),
        "local_device_type" => code.and_then(enum_name_from_code::<LocalDeviceType>),
        _ => None,
    });
    let label = device_type_label(name.as_deref());
    CodeNameLabel { code, name, label }
}

fn device_index_json(value: Option<&str>, code: Option<i64>) -> JsonValue {
    if let Some(value) = value.and_then(clean_name) {
        JsonValue::String(value)
    } else if let Some(code) = code {
        JsonValue::from(code)
    } else {
        JsonValue::Null
    }
}

fn is_creator_index(value: Option<&str>, code: Option<i64>) -> bool {
    value
        .map(|v| v.eq_ignore_ascii_case("creator"))
        .unwrap_or(false)
        || code == Some(0)
}

fn role_for(raw: &RawDeviceInfo, source_type: &CodeNameLabel) -> String {
    if is_creator_index(raw.device_index_value.as_deref(), raw.device_index_code) {
        return "primary".to_string();
    }

    match source_type.name.as_deref() {
        Some("ant" | "antplus" | "bluetooth" | "bluetooth_low_energy") => "accessory",
        Some("local") => "internal",
        _ => "unknown",
    }
    .to_string()
}

fn device_identity_key(
    raw: &RawDeviceInfo,
    source_type: &CodeNameLabel,
    manufacturer: &CodeNameLabel,
    product: &ProductMetadata,
    role: &str,
) -> String {
    if let Some(serial) = raw.serial_number {
        return format!(
            "serial:{role}:{}:{}:{}:{}:{}",
            source_type.name.as_deref().unwrap_or(""),
            manufacturer.name.as_deref().unwrap_or(""),
            product.field.as_deref().unwrap_or(""),
            product.code.map(|v| v.to_string()).or_else(|| product.name.clone()).unwrap_or_default(),
            serial
        );
    }

    let ant_number = raw.ant_device_number.map(|v| v.to_string()).unwrap_or_default();
    let ant_tx = raw.ant_transmission_type.map(|v| v.to_string()).unwrap_or_default();
    if !ant_number.is_empty() || !ant_tx.is_empty() {
        return format!(
            "ant:{role}:{}:{}:{}:{}:{}:{}",
            source_type.name.as_deref().unwrap_or(""),
            manufacturer.name.as_deref().unwrap_or(""),
            product.field.as_deref().unwrap_or(""),
            product.code.map(|v| v.to_string()).or_else(|| product.name.clone()).unwrap_or_default(),
            ant_number,
            ant_tx
        );
    }

    format!(
        "index:{role}:{}:{}:{}:{}",
        source_type.name.as_deref().unwrap_or(""),
        manufacturer.name.as_deref().unwrap_or(""),
        product.code.map(|v| v.to_string()).or_else(|| product.name.clone()).unwrap_or_default(),
        raw.device_index_value
            .clone()
            .or_else(|| raw.device_index_code.map(|v| v.to_string()))
            .unwrap_or_default()
    )
}

fn merge_latest_string(target: &mut Option<String>, value: &Option<String>) {
    if value.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        *target = value.clone();
    }
}

fn merge_latest_i64(target: &mut Option<i64>, value: Option<i64>) {
    if value.is_some() {
        *target = value;
    }
}

fn merge_latest_f64(target: &mut Option<f64>, value: Option<f64>) {
    if value.is_some() {
        *target = value;
    }
}

#[derive(Debug)]
struct DeviceAccumulator {
    device: DeviceMetadata,
    index_keys: BTreeSet<String>,
    type_keys: BTreeSet<String>,
    first_seen_ms: Option<i64>,
    last_seen_ms: Option<i64>,
}

impl DeviceAccumulator {
    fn new(raw: &RawDeviceInfo) -> Self {
        let source_type = resolve_source_type(raw.source_type_value.as_deref(), raw.source_type_code);
        let manufacturer = resolve_manufacturer(raw.manufacturer_value.as_deref());
        let product = resolve_product(raw.product_field.as_deref(), raw.product_value.as_deref(), &manufacturer);
        let role = role_for(raw, &source_type);
        let device = DeviceMetadata {
            role,
            device_indices: Vec::new(),
            source_type,
            device_types: Vec::new(),
            manufacturer,
            product,
            serial_number: raw.serial_number,
            software_version: raw.software_version.clone(),
            hardware_version: raw.hardware_version,
            battery_status: raw.battery_status.clone(),
            battery_level: raw.battery_level,
            battery_voltage: raw.battery_voltage,
            identifiers: DeviceIdentifiers {
                ant_device_number: raw.ant_device_number,
                ant_transmission_type: raw.ant_transmission_type,
                ant_network: resolve_ant_network(raw.ant_network_value.as_deref(), raw.ant_network_code),
                descriptor: raw.descriptor.clone(),
            },
            first_seen_utc: raw.timestamp_ms.and_then(utc_from_millis),
            last_seen_utc: raw.timestamp_ms.and_then(utc_from_millis),
        };

        let mut acc = Self {
            device,
            index_keys: BTreeSet::new(),
            type_keys: BTreeSet::new(),
            first_seen_ms: raw.timestamp_ms,
            last_seen_ms: raw.timestamp_ms,
        };
        acc.merge(raw);
        acc
    }

    fn merge(&mut self, raw: &RawDeviceInfo) {
        let index = device_index_json(raw.device_index_value.as_deref(), raw.device_index_code);
        let index_key = index.to_string();
        if index != JsonValue::Null && self.index_keys.insert(index_key) {
            self.device.device_indices.push(index);
        }

        for raw_type in &raw.device_types {
            let device_type = resolve_device_type(raw_type);
            let type_key = format!(
                "{}:{}",
                device_type.code.map(|v| v.to_string()).unwrap_or_default(),
                device_type.name.as_deref().unwrap_or("")
            );
            if self.type_keys.insert(type_key) {
                self.device.device_types.push(device_type);
            }
        }

        if let Some(timestamp_ms) = raw.timestamp_ms {
            self.first_seen_ms = Some(self.first_seen_ms.map_or(timestamp_ms, |v| v.min(timestamp_ms)));
            self.last_seen_ms = Some(self.last_seen_ms.map_or(timestamp_ms, |v| v.max(timestamp_ms)));
            self.device.first_seen_utc = self.first_seen_ms.and_then(utc_from_millis);
            self.device.last_seen_utc = self.last_seen_ms.and_then(utc_from_millis);
        }

        merge_latest_string(&mut self.device.software_version, &raw.software_version);
        merge_latest_i64(&mut self.device.hardware_version, raw.hardware_version);
        merge_latest_string(&mut self.device.battery_status, &raw.battery_status);
        merge_latest_f64(&mut self.device.battery_level, raw.battery_level);
        merge_latest_f64(&mut self.device.battery_voltage, raw.battery_voltage);
        merge_latest_i64(&mut self.device.identifiers.ant_device_number, raw.ant_device_number);
        merge_latest_i64(
            &mut self.device.identifiers.ant_transmission_type,
            raw.ant_transmission_type,
        );
        if let Some(ant_network) = resolve_ant_network(raw.ant_network_value.as_deref(), raw.ant_network_code) {
            self.device.identifiers.ant_network = Some(ant_network);
        }
        merge_latest_string(&mut self.device.identifiers.descriptor, &raw.descriptor);
    }
}

fn role_order(role: &str) -> usize {
    match role {
        "primary" => 0,
        "accessory" => 1,
        "internal" => 2,
        _ => 3,
    }
}

fn type_order(device: &DeviceMetadata) -> usize {
    let names = device
        .device_types
        .iter()
        .filter_map(|device_type| device_type.name.as_deref())
        .collect::<Vec<_>>();
    if names.iter().any(|name| *name == "heart_rate") {
        0
    } else if names.iter().any(|name| *name == "bike_power") {
        1
    } else if names.iter().any(|name| *name == "bike_cadence") {
        2
    } else if names.iter().any(|name| *name == "bike_speed") {
        3
    } else if names.iter().any(|name| *name == "bike_speed_cadence") {
        4
    } else if names.iter().any(|name| *name == "bike_radar") {
        5
    } else if names
        .iter()
        .any(|name| *name == "bike_light_main" || *name == "bike_light_shared")
    {
        6
    } else if names.iter().any(|name| *name == "shifting") {
        7
    } else if names.iter().any(|name| *name == "temperature") {
        8
    } else {
        9
    }
}

fn display_sort_label(device: &DeviceMetadata) -> String {
    [
        device.manufacturer.label.clone(),
        device.product.label.clone(),
        device
            .device_types
            .first()
            .and_then(|device_type| device_type.label.clone()),
        device.serial_number.map(|serial| serial.to_string()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

pub fn build_devices(raw_records: &[RawDeviceInfo]) -> Vec<DeviceMetadata> {
    let mut devices: BTreeMap<String, DeviceAccumulator> = BTreeMap::new();
    for raw in raw_records {
        let source_type = resolve_source_type(raw.source_type_value.as_deref(), raw.source_type_code);
        let manufacturer = resolve_manufacturer(raw.manufacturer_value.as_deref());
        let product = resolve_product(raw.product_field.as_deref(), raw.product_value.as_deref(), &manufacturer);
        let role = role_for(raw, &source_type);
        let key = device_identity_key(raw, &source_type, &manufacturer, &product, &role);
        devices
            .entry(key)
            .and_modify(|acc| acc.merge(raw))
            .or_insert_with(|| DeviceAccumulator::new(raw));
    }

    let mut devices = devices
        .into_values()
        .map(|acc| acc.device)
        .collect::<Vec<_>>();
    devices.sort_by(|a, b| {
        role_order(&a.role)
            .cmp(&role_order(&b.role))
            .then_with(|| type_order(a).cmp(&type_order(b)))
            .then_with(|| display_sort_label(a).cmp(&display_sort_label(b)))
    });
    devices
}

pub fn decoded_file_id(raw: &RawFileId) -> DecodedFileIdMetadata {
    let manufacturer = resolve_manufacturer(raw.manufacturer_value.as_deref());
    let product = resolve_product(raw.product_field.as_deref(), raw.product_value.as_deref(), &manufacturer);
    DecodedFileIdMetadata {
        manufacturer,
        product,
        serial_number: raw.serial_number,
        time_created_utc: raw.time_created_ms.and_then(utc_from_millis),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reverse_mapping_preserves_valid_zero_codes() {
        assert_eq!(reverse_fit_enum::<LocalDeviceType>("gps"), Some(0));
    }

    #[test]
    fn reverse_mapping_rejects_unknown_zero_fallbacks() {
        assert_eq!(reverse_fit_enum::<GarminProduct>("not_a_product"), None);
    }

    #[test]
    fn garmin_forerunner_labels_expand_fr_prefix() {
        assert_eq!(product_label(Some("fr255")).as_deref(), Some("Forerunner 255"));
        assert_eq!(
            product_label(Some("fr255_small_music")).as_deref(),
            Some("Forerunner 255S Music")
        );
    }

    #[test]
    fn garmin_hrm_200_overlay_fills_sdk_gap() {
        let manufacturer = resolve_manufacturer(Some("garmin"));
        let product = resolve_product(Some("garmin_product"), Some("4606"), &manufacturer);
        assert_eq!(product.code, Some(4606));
        assert_eq!(product.name.as_deref(), Some("hrm_200"));
        assert_eq!(product.label.as_deref(), Some("HRM 200"));
        assert_eq!(product.lookup_source, "app_overlay");
    }

    #[test]
    fn same_serial_radar_and_light_records_merge_types() {
        let base = RawDeviceInfo {
            source_type_value: Some("antplus".to_string()),
            source_type_code: Some(1),
            manufacturer_value: Some("garmin".to_string()),
            product_field: Some("garmin_product".to_string()),
            product_value: Some("3592".to_string()),
            serial_number: Some(123),
            ..Default::default()
        };
        let mut light = base.clone();
        light.device_index_value = Some("5".to_string());
        light.device_index_code = Some(5);
        light.device_types.push(RawDeviceType {
            field: "antplus_device_type".to_string(),
            value: "bike_light_main".to_string(),
            code: Some(35),
        });
        let mut radar = base;
        radar.device_index_value = Some("6".to_string());
        radar.device_index_code = Some(6);
        radar.device_types.push(RawDeviceType {
            field: "antplus_device_type".to_string(),
            value: "bike_radar".to_string(),
            code: Some(40),
        });

        let devices = build_devices(&[light, radar]);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_indices, vec![JsonValue::from(5), JsonValue::from(6)]);
        let names = devices[0]
            .device_types
            .iter()
            .map(|device_type| device_type.name.as_deref())
            .collect::<Vec<_>>();
        assert!(names.contains(&Some("bike_light_main")));
        assert!(names.contains(&Some("bike_radar")));
    }
}
