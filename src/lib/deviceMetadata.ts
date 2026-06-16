import type { Activity } from "../types";

export type CodeNameLabel = {
  code?: number | null;
  name?: string | null;
  label?: string | null;
};

export type ProductMetadata = {
  field?: string | null;
  code?: number | null;
  name?: string | null;
  label?: string | null;
  lookup_source?: string | null;
};

export type DeviceMetadata = {
  role?: string | null;
  device_indices?: Array<string | number | null>;
  source_type?: CodeNameLabel | null;
  device_types?: CodeNameLabel[];
  manufacturer?: CodeNameLabel | null;
  product?: ProductMetadata | null;
  serial_number?: number | null;
  software_version?: string | null;
  hardware_version?: number | null;
  battery_status?: string | null;
  battery_level?: number | null;
  battery_voltage?: number | null;
  identifiers?: {
    ant_device_number?: number | null;
    ant_transmission_type?: number | null;
    ant_network?: string | null;
    descriptor?: string | null;
  } | null;
  first_seen_utc?: string | null;
  last_seen_utc?: string | null;
};

export type DeviceInfoMetadata = {
  schema_version?: number | null;
  source_support?: string | null;
  creator_product_name?: string | null;
  creator_serial_number?: number | null;
  fallback_product_name?: string | null;
  fallback_serial_number?: number | null;
  decoded_file_id?: {
    manufacturer?: CodeNameLabel | null;
    product?: ProductMetadata | null;
    serial_number?: number | null;
    time_created_utc?: string | null;
  } | null;
  devices?: DeviceMetadata[];
  raw_device_info_record_count?: number | null;
};

export type ActivityMetadata = {
  heart_rate_zone_bounds_bpm?: number[];
  file_id?: {
    product_name?: string | null;
    serial_number?: number | null;
  };
  device_info?: DeviceInfoMetadata | null;
  activity_metrics?: {
    vo2_max?: number | null;
  };
  session?: {
    beginning_body_battery?: number | null;
    ending_body_battery?: number | null;
    max_heart_rate?: number | null;
    avg_heart_rate?: number | null;
    max_cadence?: number | null;
    avg_cadence?: number | null;
    total_elapsed_time_s?: number | null;
    total_distance_m?: number | null;
    total_calories?: number | null;
  };
  laps?: Array<{
    start_ts_utc?: string | null;
    end_ts_utc?: string | null;
    total_elapsed_time_s?: number | null;
    total_timer_time_s?: number | null;
    total_distance_m?: number | null;
    avg_speed_m_s?: number | null;
    max_speed_m_s?: number | null;
    avg_heart_rate?: number | null;
    max_heart_rate?: number | null;
    total_ascent_m?: number | null;
    total_descent_m?: number | null;
    avg_cadence?: number | null;
    max_cadence?: number | null;
    total_calories?: number | null;
    best_speed_m_s?: number | null;
  }>;
};

export function parseActivityMetadata(raw?: string): ActivityMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActivityMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function labelFromIdentifier(value?: string | null): string | null {
  if (!value) return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["ant", "gps", "gnss", "hr", "hrm", "ble", "ohr"].includes(lower)) {
        return lower.toUpperCase();
      }
      if (lower === "antplus") return "ANT+";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function firstDeviceTypeLabel(device: DeviceMetadata): string | null {
  return device.device_types?.find((type) => type.label || type.name)?.label
    ?? labelFromIdentifier(device.device_types?.find((type) => type.name)?.name)
    ?? null;
}

function hasDeviceType(device: DeviceMetadata, names: string[], codes: number[]): boolean {
  return (device.device_types ?? []).some((type) => {
    const name = type.name?.toLowerCase();
    return (name ? names.includes(name) : false)
      || (typeof type.code === "number" ? codes.includes(type.code) : false);
  });
}

function isExternalSource(device: DeviceMetadata): boolean {
  return ["ant", "antplus", "bluetooth", "bluetooth_low_energy"].includes(
    device.source_type?.name?.toLowerCase() ?? ""
  );
}

function isGarmin(device: DeviceMetadata): boolean {
  return device.manufacturer?.name?.toLowerCase() === "garmin" || device.manufacturer?.code === 1;
}

function displayManufacturerLabel(device: DeviceMetadata): string | null {
  return device.manufacturer?.label
    ?? labelFromIdentifier(device.manufacturer?.name)
    ?? null;
}

function forerunnerLabel(value?: string | null): string | null {
  const match = value?.match(/^fr(\d+)(m)?(?:_(.*))?$/i);
  if (!match) return null;

  const [, model, musicSuffix, rawRest] = match;
  let modelSuffix = "";
  const descriptors = new Set<string>();
  if (musicSuffix) descriptors.add("Music");

  for (const part of rawRest?.split("_").filter(Boolean) ?? []) {
    const lower = part.toLowerCase();
    if (lower === "small" || lower === "s") modelSuffix += "S";
    else if (lower === "large") continue;
    else if (lower === "m" || lower === "music") descriptors.add("Music");
    else if (lower === "lte") descriptors.add("LTE");
    else if (lower === "apac") descriptors.add("APAC");
    else if (lower === "sea") descriptors.add("SEA");
    else descriptors.add(labelFromIdentifier(lower) ?? part);
  }

  const suffix = descriptors.size > 0 ? ` ${Array.from(descriptors).join(" ")}` : "";
  return `Forerunner ${model}${modelSuffix}${suffix}`;
}

function derivedProductLabel(device: DeviceMetadata): string | null {
  const product = device.product;
  if (isGarmin(device)) {
    if (
      product?.code === 3592
      && hasDeviceType(device, ["bike_light_main", "bike_light_shared", "bike_radar"], [35, 40])
    ) {
      return "Varia RTL515";
    }

    if (
      (product?.code === 4606 || product?.name === "hrm_200")
      || (
        product?.code === 255
        && isExternalSource(device)
        && hasDeviceType(device, ["heart_rate"], [120])
      )
    ) {
      return "HRM 200";
    }
  }

  return forerunnerLabel(product?.name)
    ?? product?.label
    ?? labelFromIdentifier(product?.name)
    ?? (typeof product?.code === "number" ? `Product ${product.code}` : null);
}

export function formatDeviceLabel(device: DeviceMetadata): string {
  const manufacturer = displayManufacturerLabel(device) ?? "";
  const product = derivedProductLabel(device)
    ?? firstDeviceTypeLabel(device)
    ?? "";
  return [manufacturer, product].filter(Boolean).join(" ").trim()
    || firstDeviceTypeLabel(device)
    || "Device";
}

function typeOrder(device: DeviceMetadata): number {
  const names = new Set((device.device_types ?? []).map((type) => type.name));
  if (names.has("heart_rate")) return 0;
  if (names.has("bike_power")) return 1;
  if (names.has("bike_cadence")) return 2;
  if (names.has("bike_speed")) return 3;
  if (names.has("bike_speed_cadence")) return 4;
  if (names.has("bike_radar")) return 5;
  if (names.has("bike_light_main") || names.has("bike_light_shared")) return 6;
  if (names.has("shifting")) return 7;
  if (names.has("temperature")) return 8;
  return 9;
}

export function getAccessoryDevices(metadata: ActivityMetadata | null): DeviceMetadata[] {
  return [...(metadata?.device_info?.devices ?? [])]
    .filter((device) => device.role === "accessory")
    .sort((a, b) => {
      const byType = typeOrder(a) - typeOrder(b);
      if (byType !== 0) return byType;
      return formatDeviceLabel(a).localeCompare(formatDeviceLabel(b));
    });
}

export function getPrimaryDevice(metadata: ActivityMetadata | null): DeviceMetadata | null {
  return metadata?.device_info?.devices?.find((device) => device.role === "primary") ?? null;
}

function decodedFileIdLabel(info?: DeviceInfoMetadata | null): string | null {
  const decoded = info?.decoded_file_id;
  if (!decoded) return null;

  const manufacturer = decoded.manufacturer?.label
    ?? labelFromIdentifier(decoded.manufacturer?.name)
    ?? null;
  const product = decoded.product?.label
    ?? labelFromIdentifier(decoded.product?.name)
    ?? null;
  const label = [manufacturer, product].filter(Boolean).join(" ").trim();
  return label || null;
}

export function getPrimaryDeviceLabel(
  metadata: ActivityMetadata | null,
  activity?: Pick<Activity, "device"> | null
): string {
  const primary = getPrimaryDevice(metadata);
  if (primary) return formatDeviceLabel(primary);
  return decodedFileIdLabel(metadata?.device_info)
    || activity?.device
    || metadata?.file_id?.product_name
    || "";
}

function buildExportDevice(device: DeviceMetadata) {
  return {
    ...device,
    display: {
      name: formatDeviceLabel(device),
      manufacturer: displayManufacturerLabel(device),
      product: derivedProductLabel(device),
      deviceType: firstDeviceTypeLabel(device),
    },
  };
}

export function buildExportDeviceInfo(metadata: ActivityMetadata | null) {
  const info = metadata?.device_info;
  if (!info) return null;

  const devices = info.devices ?? [];
  return {
    schemaVersion: info.schema_version ?? null,
    sourceSupport: info.source_support ?? null,
    decodedFileId: info.decoded_file_id ?? null,
    primary: devices.filter((device) => device.role === "primary").map(buildExportDevice),
    accessories: getAccessoryDevices(metadata).map(buildExportDevice),
    internal: devices.filter((device) => device.role === "internal").map(buildExportDevice),
    devices: devices.map(buildExportDevice),
    rawDeviceInfoRecordCount: info.raw_device_info_record_count ?? null,
  };
}
