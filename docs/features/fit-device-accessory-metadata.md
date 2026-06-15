# FIT Device and Accessory Metadata

## Problem

FIT activity files can include more than one device. A single activity may be
recorded by a primary watch or cycling computer while also receiving data from
accessories such as a heart rate monitor, power meter, speed sensor, radar, or
light.

The current app persists one display device string on `activities.device`. It
also keeps a small amount of device metadata in `metadata_json`, but that
metadata only tracks a creator device and a fallback device. Accessory records
are not preserved for export or UI display.

This makes the exported JSON incomplete for users who want to know which sensors
contributed to an activity, and it can make the activity header misleading when
a serial number is shown without enough context.

## Current Behaviour

During FIT import, the parser inspects `file_id` and `device_info` messages.
The persisted `activities.device` value is selected using this priority:

1. `device_info` where `device_index` is `creator` or numeric `0`
2. `file_id` manufacturer/product
3. first available `device_info` record

The current metadata shape is effectively:

```json
{
  "file_id": {
    "product_name": "garmin edge_1040",
    "serial_number": 1234567890
  },
  "device_info": {
    "creator_product_name": "garmin edge_1040",
    "creator_serial_number": 1234567890,
    "fallback_product_name": "garmin edge_1040",
    "fallback_serial_number": 1234567890
  }
}
```

This loses the complete list of `device_info` records.

## Proposed Solution

Keep `activities.device` as the primary recorder display string for backward
compatibility. Keep the existing top-level `metadata_json.file_id` object for
current readers, but enrich `metadata_json.device_info` with a versioned full
list of devices discovered in the FIT file.

Persist raw and FIT-profile-derived facts in `metadata_json`: numeric codes,
SDK enum names when available, source type, device type, manufacturer, serial
number, identifiers, and timestamps. Product substitutions and user-facing
labels that are not directly provided by the FIT profile should be derived in
the UI/export layer so improved lookup tables can apply to old rows without a
metadata backfill.

Suggested metadata shape:

```json
{
  "file_id": {
    "product_name": "garmin edge_1040",
    "serial_number": 3609441582
  },
  "device_info": {
    "schema_version": 1,
    "source_support": "full",
    "creator_product_name": "garmin edge_1040",
    "creator_serial_number": 3609441582,
    "fallback_product_name": "garmin edge_1040",
    "fallback_serial_number": 3609441582,
    "decoded_file_id": {
      "manufacturer": { "code": 1, "name": "garmin", "label": "Garmin" },
      "product": {
        "field": "garmin_product",
        "code": 3843,
        "name": "edge_1040",
        "label": "Edge 1040",
        "lookup_source": "fit_profile"
      },
      "serial_number": 3609441582,
      "time_created_utc": "2026-06-11T14:21:20Z"
    },
    "devices": [
      {
        "role": "primary",
        "device_indices": ["creator"],
        "source_type": { "code": 5, "name": "local", "label": "Local" },
        "device_types": [],
        "manufacturer": { "code": 1, "name": "garmin", "label": "Garmin" },
        "product": {
          "field": "garmin_product",
          "code": 3843,
          "name": "edge_1040",
          "label": "Edge 1040",
          "lookup_source": "fit_profile"
        },
        "serial_number": 3609441582,
        "software_version": "31.30",
        "hardware_version": null,
        "battery_status": null,
        "battery_level": null,
        "identifiers": {
          "ant_device_number": null,
          "ant_transmission_type": null,
          "ant_network": null,
          "descriptor": null
        },
        "first_seen_utc": "2026-06-11T14:21:20Z",
        "last_seen_utc": "2026-06-11T18:57:53Z"
      },
      {
        "role": "accessory",
        "device_indices": [3],
        "source_type": {
          "code": 3,
          "name": "bluetooth_low_energy",
          "label": "Bluetooth Low Energy"
        },
        "device_types": [{ "code": 1, "name": "heart_rate", "label": "Heart Rate" }],
        "manufacturer": { "code": 1, "name": "garmin", "label": "Garmin" },
        "product": {
          "field": "garmin_product",
          "code": 4606,
          "name": null,
          "label": null,
          "lookup_source": "raw"
        },
        "serial_number": 3618094325,
        "software_version": "5.40",
        "hardware_version": 66,
        "battery_status": "good",
        "battery_level": 80,
        "identifiers": {
          "ant_device_number": null,
          "ant_transmission_type": null,
          "ant_network": "antplus",
          "descriptor": null
        },
        "first_seen_utc": "2026-06-11T14:21:20Z",
        "last_seen_utc": "2026-06-11T18:57:53Z"
      },
      {
        "role": "accessory",
        "device_indices": [4],
        "source_type": { "code": 1, "name": "antplus", "label": "ANT+" },
        "device_types": [{ "code": 11, "name": "bike_power", "label": "Power Meter" }],
        "manufacturer": { "code": 263, "name": "favero_electronics", "label": "Favero" },
        "product": {
          "field": "favero_product",
          "code": 12,
          "name": "assioma_duo",
          "label": "Assioma Duo",
          "lookup_source": "fit_profile"
        },
        "serial_number": 2368736719,
        "software_version": "6.24",
        "hardware_version": 4,
        "battery_status": "ok",
        "battery_voltage": 3.86328125,
        "identifiers": {
          "ant_device_number": null,
          "ant_transmission_type": null,
          "ant_network": "antplus",
          "descriptor": null
        },
        "first_seen_utc": "2026-06-11T14:21:20Z",
        "last_seen_utc": "2026-06-11T18:57:53Z"
      },
      {
        "role": "accessory",
        "device_indices": [5, 6],
        "source_type": { "code": 1, "name": "antplus", "label": "ANT+" },
        "device_types": [
          { "code": 35, "name": "bike_light_main", "label": "Bike Light" },
          { "code": 40, "name": "bike_radar", "label": "Bike Radar" }
        ],
        "manufacturer": { "code": 1, "name": "garmin", "label": "Garmin" },
        "product": {
          "field": "garmin_product",
          "code": 3592,
          "name": null,
          "label": null,
          "lookup_source": "raw"
        },
        "serial_number": 3604924594,
        "software_version": "3.36",
        "hardware_version": 66,
        "identifiers": {
          "ant_device_number": null,
          "ant_transmission_type": null,
          "ant_network": "antplus",
          "descriptor": null
        },
        "first_seen_utc": "2026-06-11T14:21:20Z",
        "last_seen_utc": "2026-06-11T18:57:53Z"
      }
    ],
    "raw_device_info_record_count": 12
  }
}
```

Use `code` for the raw numeric FIT value when available. Use `name` only for
stable enum-style identifiers supplied by the FIT profile or recovered through a
guarded reverse lookup. The `fitparser` API returns decoded strings for many
known profile values and does not expose a separate raw value, so implementation
should reverse-map known decoded strings through the generated FIT enum helpers.
Reverse mapping must use a round-trip guard, such as checking that converting
the numeric enum back to a string matches the original decoded name, to avoid
treating unknown strings as valid code `0`. Preserve numeric codes when they are
already present, especially unresolved products such as Garmin product `4606`,
Garmin product `3592`, or Magene product `3`.

`label` values in persisted metadata are compatibility/display hints, not the
source of truth. New manual substitutions should not be written as persisted
product names or labels. The UI can compose full labels such as `Garmin HRM 200`
from manufacturer facts, product codes, source type, and device type.

The `devices[]` entries represent physical devices, not raw FIT records. When a
single physical accessory appears with multiple functions, such as radar and
light, merge it into one entry with multiple `device_types` and `device_indices`
only when stable identifiers show that the records came from the same physical
device. Separate lights, radars, or sensor units must remain separate entries.

## Classification Rules

Use FIT `device_info` fields to classify records:

- `role: "primary"` when `device_index` is `creator` or numeric `0`
- `role: "accessory"` when `device_index` is not creator/0 and decoded
  `source_type` is `antplus`, `bluetooth`, or `bluetooth_low_energy`
- `role: "internal"` when `device_index` is not creator/0 and decoded
  `source_type` is `local`

The FIT profile exposes source-specific device type fields. Normalise them into
`device_types[]` based on `source_type`:

- `source_type=antplus`: use `antplus_device_type`
- `source_type=bluetooth_low_energy`: use `ble_device_type`
- `source_type=local`: use `local_device_type`
- unknown source: preserve the raw `device_type` code with `name: null`

Examples:

- `source_type=local`, `device_index=creator`, Garmin product `edge_1040`:
  primary recorder
- `source_type=bluetooth_low_energy`, `device_types=["heart_rate"]`: accessory
  heart rate monitor
- `source_type=antplus`, `device_types=["bike_power"]`: accessory power meter
- `source_type=local`, `device_types=["gps"]`: internal device component

## Lookup Tables

The app can use the generated FIT profile data already available through
`fitparser`:

- `Manufacturer`
- `GarminProduct`
- `FaveroProduct`
- `AntplusDeviceType`
- `BleDeviceType`
- `LocalDeviceType`
- `SourceType`

Product codes must be decoded in a manufacturer-specific way. For example,
manufacturer `favero_electronics` with product code `12` resolves to
`assioma_duo`, while the same product code would mean something different under
another manufacturer.

Supplement FIT profile lookups with a small app-owned display lookup table for
products that the current SDK does not name yet. These entries should be applied
by the UI/export resolver, not by rewriting persisted product names. The display
lookup key should be exact and may include context when a code is ambiguous:

```text
manufacturer + product_field + product_code + source_type + device_type
```

Example display lookup entries:

```text
garmin + garmin_product + 4606 + any + heart_rate -> HRM 200
garmin + garmin_product/product + 255 + antplus + heart_rate -> HRM 200
garmin + garmin_product/product + 3592 + antplus + bike_radar/bike_light_main -> Varia RTL515
```

Persistence resolution order:

1. Use the FIT SDK/profile result when it provides a usable product name. Populate
   `code` by reverse-mapping decoded strings through the matching generated enum
   helper when the raw numeric value is not exposed directly.
2. Preserve the raw product code with `name: null`, `label: null`, and
   `lookup_source: "raw"` when the FIT profile does not resolve it.
3. Do not persist app-owned display substitutions as authoritative product
   names. Keep raw product codes even when a display lookup succeeds.

Display/export resolution order:

1. Use an app-owned display lookup when a raw product code plus context identifies
   a more useful device name.
2. Use the FIT SDK/profile product name when available.
3. Fall back to manufacturer plus device type.
4. Fall back to raw product code.

Display lookup entries fill SDK gaps by default; they should not override a
usable SDK name unless a future entry explicitly opts into that behaviour.

Reverse mapping helpers should be centralized and covered by tests. Test cases
should include known values with code `0`, unknown strings that would otherwise
fall through to `0`, and manufacturer-specific product fields such as
`garmin_product` and `favero_product`.

Product metadata fields:

- `field`: FIT product field name, such as `garmin_product`, `favero_product`,
  or generic `product`
- `code`: raw numeric product code, from the parser when exposed directly or from
  guarded reverse mapping when the parser exposes a decoded string
- `name`: stable FIT-profile enum-style identifier when known, such as
  `assioma_duo`; unresolved product codes should keep `name: null`
- `label`: optional compatibility/display hint; manual substitutions should be
  derived in UI/export rather than persisted here
- `lookup_source`: `fit_profile` or `raw`

Display fallback order for a full accessory label:

1. derived manufacturer label + derived product label from the display lookup or
   FIT profile name
2. derived manufacturer label + device type label
3. device type label
4. `Unknown accessory`

Examples from observed files:

- Garmin product code `4606` with BLE type `heart_rate` remains raw product code
  metadata, but displays as `Garmin HRM 200`.
- Garmin product code `255` with ANT+ type `heart_rate` may be decoded by the SDK
  as `OHR`; when it is an external ANT+/Bluetooth heart-rate accessory, display
  it as `Garmin HRM 200`.
- Garmin product code `3592` with ANT+ `bike_radar` and `bike_light_main` records
  remains raw product code metadata, but displays as `Garmin Varia RTL515`.
- Magene product code `3` with ANT+ type `bike_speed` remains raw product code
  metadata, but displays as `Magene bike speed sensor`.
- Magene product code `3` with ANT+ type `bike_cadence` remains raw product code
  metadata, but displays as `Magene bike cadence sensor`.

TCX and GPX files should use the same metadata envelope when possible, but they
usually provide less device data:

- FIT: `source_support: "full"` when `device_info` records are available
- TCX: `source_support: "primary_only"` when only `Activity/Creator` is
  available
- GPX: `source_support: "creator_only"` when only the GPX `creator` string is
  available
- no useful source metadata: `source_support: "none"` and `devices: []`

## De-duplication

FIT files often repeat `device_info` records at the start and end of an
activity. De-duplicate device entries by the strongest stable identity fields
available:

- serial number when present and greater than zero, scoped by manufacturer,
  product, and source type
- ANT identifiers when present: `ant_device_number`, `ant_transmission_type`,
  and `ant_network`
- BLE descriptor or address-like identifiers when available
- device index, when needed to avoid merging distinct components or records
  without stable serial/ANT/BLE identity

Use device type as classification and fallback identity only. It should not
prevent merging multiple functions from the same physical device when stable
identifiers match, and it should not cause separate physical devices to merge
solely because they share a manufacturer/product/source type.

For duplicate records, keep a single device entry and merge useful changing
fields:

- earliest timestamp as `first_seen_utc`
- latest timestamp as `last_seen_utc`
- latest non-null battery level/status
- latest software and hardware versions
- union of `device_indices`
- union of `device_types`

If serial number is missing or `0`, do not use it as a unique identity. Fall
back to source-specific identifiers first, then to manufacturer/product/source
type/device type/device index.

## UI and Export Behaviour

The activity header should show the primary display device, such as
`Garmin Edge 1040`, not a serial number. Serial numbers may be included in
metadata and export, but should not be the compact display label.

The primary device label can expose accessory details on hover or keyboard
focus. The tooltip or popover should list accessory display labels grouped by
type, such as heart rate monitor, power meter, radar, and lights. When no
accessories are present, the hover state should stay minimal rather than showing
an empty accessory section.

JSON export should include the enriched device metadata while preserving the
existing `activity.device` field. Device entries should include raw/parsed
metadata plus a derived `display` object so exports are readable without making
friendly labels the persisted source of truth. Add a root-level `deviceInfo`
object to the export and add a device metadata version to `_exportInfo`:

```json
{
  "_exportInfo": {
    "format": "FIT Dashboard JSON Export",
    "deviceMetadataVersion": 1
  },
  "activity": {
    "device": "garmin edge_1040"
  },
  "deviceInfo": {
    "sourceSupport": "full",
    "primary": [
      {
        "role": "primary",
        "display": {
          "name": "Garmin Edge 1040",
          "manufacturer": "Garmin",
          "product": "Edge 1040",
          "deviceType": null
        }
      }
    ],
    "accessories": [],
    "internal": []
  }
}
```

CSV export can remain unchanged initially, or include a compact accessories
summary later.

Potential UI grouping:

- Primary device
- Accessories
- Internal sensors

Accessory display order should be deterministic:

1. heart rate
2. power
3. cadence
4. speed
5. speed/cadence combo
6. radar
7. lights
8. shifting/drivetrain
9. temperature
10. other sensors and accessories

Within the same accessory type, sort by display label, then manufacturer/product,
then serial number when present, then first `device_index`. JSON export should
use the same order as the UI so repeated exports are stable.

## Database and Migration

This feature can be added without a DuckDB table migration because the richer
structure fits inside existing `metadata_json`.

For a new database:

- the existing `activities` schema is created as it is today
- new imports write `metadata_json.device_info.schema_version = 1`
- new imports write `metadata_json.device_info.devices[]`
- `activities.device` continues to store the primary display device

For an existing database:

- no schema migration is required
- old rows may have no `device_info.devices` array
- UI and export code must tolerate missing `schema_version` and missing
  `devices[]`
- old rows continue to use `activities.device` and legacy
  `device_info.creator_*` / `device_info.fallback_*` metadata
- no backfill is included in the initial implementation

Backfill is a possible future item. In this context, backfill would mean
re-parsing persisted source files and updating existing rows with newly derived
metadata without deleting and re-importing the activity. It would scan the
configured FIT files directory, compute file hashes, match those hashes to
existing activities, and update only `metadata_json`. Filenames could be used as
hints, but not as the primary identity.

Any future backfill must preserve user-entered fields, especially
`activities.activity_name`, because users can rename stored activities from the
activity list. A delete-and-re-import strategy would overwrite those names with
FIT-derived names and may also disturb activity IDs, delete blacklist state, or
other local references. Future imports of new activities will produce the new
metadata, but already-imported activities need an explicit metadata refresh or
future backfill because normal duplicate detection should leave existing rows
unchanged.

Existing consumers of top-level exported `activity.device` should continue to
work unchanged, and existing consumers of top-level `metadata_json.file_id`
should continue to find that field.

## Open Questions

- Should existing activities be backfilled opportunistically from stored FIT
  files when available?
- Should internal `local` device components be shown in the UI by default, or
  only in expanded/debug views?
