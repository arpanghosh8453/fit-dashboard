# Multisport Activity Support

## Status

Design proposal for issue #21.

## Problem

FIT Dashboard currently imports an activity file as one activity. Garmin
multisport files can represent one parent activity with multiple sessions or
legs, for example bike, transition, run, transition, bike. Flattening these into
one normal activity can make the activity name, map, charts, summary metrics,
filters, and sport-specific calculations misleading.

The current parser already reads `record`, `session`, and `lap` messages, but the
database model stores records against only an `activity_id`, stores laps in
activity metadata JSON, and presents one activity row. There is no first-class
sub-activity or leg view.

## Goals

- Detect FIT multisport activities during import.
- Preserve the parent activity and each FIT session as a child leg.
- Keep transitions as child legs, but visually de-emphasize them.
- Let users view either the whole activity or one selected leg.
- Scope stats, maps, charts, laps, and calculations to the selected view.
- Prevent child legs from being double-counted in overview totals.
- Keep existing single-sport activity behavior unchanged.

## Non-Goals

- Splitting a multisport FIT file into unrelated standalone activities.
- Supporting manual editing of leg boundaries in the first implementation.
- Rewriting all chart and statistics code in one step if a narrower MVP can
  preserve correctness.
- Adding support for unrelated non-activity FIT file types.

## FIT Observations

An anonymized Garmin multisport sample was inspected for design guidance. It had:

- One FIT `activity` message with `type = auto_multi_sport`.
- Five FIT `session` messages.
- Twenty-five FIT `lap` messages.
- A mix of indoor cycling, transition, running, transition, and indoor cycling
  legs.
- GPS records only in the transition and running legs. The indoor cycling legs
  had no GPS records.
- Heart-rate records throughout the legs.
- Power records in the cycling legs and also in the running leg for this sample.

Important parser nuance: in this sample, the FIT `session.timestamp` and
`lap.timestamp` values were not usable as segment end times. They repeated the
parent activity timestamp. The parser must not assume `timestamp` is the end of a
session or lap. Use `start_time` plus `total_timer_time` or `total_elapsed_time`,
and use adjacent session starts as assignment boundaries when available.

## Data Model

Keep `activities` as the parent activity table. Add child segments rather than
creating fake child activities with duplicate file hashes.

### activities

Add fields:

- `activity_kind VARCHAR DEFAULT 'single'`
  - `single`: current behavior.
  - `multisport_parent`: a parent activity with child segments.
- `parent_summary_json VARCHAR` or extend existing `metadata_json`
  - Stores parent-level FIT activity data, raw session summaries, and migration
    helpers.

For multisport parents:

- `sport` should be `multisport`.
- `activity_name` should not be derived from GPS from only one child leg.
- `duration_s` should use FIT activity `total_timer_time` when present, then
  fall back to the sum of session timer durations.
- `distance_m` should use FIT activity total distance when present, then fall
  back to the sum of session distances.

### activity_segments

Create a new table:

```sql
CREATE TABLE IF NOT EXISTS activity_segments (
    id BIGINT PRIMARY KEY,
    activity_id BIGINT NOT NULL,
    segment_index BIGINT NOT NULL,
    segment_type VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    sport VARCHAR,
    sub_sport VARCHAR,
    start_ts_utc TIMESTAMP,
    end_ts_utc TIMESTAMP,
    timer_duration_s REAL,
    elapsed_duration_s REAL,
    distance_m REAL,
    start_latitude DOUBLE,
    start_longitude DOUBLE,
    metadata_json VARCHAR
);
```

Recommended `segment_type` values:

- `sport`
- `transition`

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_activity_segments_activity
    ON activity_segments(activity_id, segment_index);
```

### records

Add a nullable `segment_id`:

```sql
ALTER TABLE records ADD COLUMN IF NOT EXISTS segment_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_records_segment_time
    ON records(segment_id, timestamp_ms);
```

Existing single-sport records can keep `segment_id = NULL`. Multisport records
should keep their parent `activity_id` and also receive the matching
`segment_id`.

### laps

The existing importer stores laps inside `metadata_json`. Multisport needs laps
to be scoped to a selected leg, so add a first-class lap table:

```sql
CREATE TABLE IF NOT EXISTS activity_laps (
    id BIGINT PRIMARY KEY,
    activity_id BIGINT NOT NULL,
    segment_id BIGINT,
    lap_index BIGINT NOT NULL,
    start_ts_utc TIMESTAMP,
    end_ts_utc TIMESTAMP,
    timer_duration_s REAL,
    elapsed_duration_s REAL,
    distance_m REAL,
    avg_speed_m_s REAL,
    max_speed_m_s REAL,
    avg_heart_rate BIGINT,
    max_heart_rate BIGINT,
    avg_cadence BIGINT,
    max_cadence BIGINT,
    total_ascent_m REAL,
    total_descent_m REAL,
    total_calories BIGINT,
    metadata_json VARCHAR
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_activity_laps_activity
    ON activity_laps(activity_id, lap_index);
CREATE INDEX IF NOT EXISTS idx_activity_laps_segment
    ON activity_laps(segment_id, lap_index);
```

## Import and Parser Rules

### Detection

Treat a FIT file as multisport when:

1. The FIT `activity.type` is `auto_multi_sport` or another recognized
   multisport activity type.
2. Or the file contains more than one FIT `session` with distinct session start
   times and at least one sport transition.

Condition 1 is the strongest signal. Condition 2 is a fallback for compatible
files that encode multiple sessions without the expected activity type.

### Segment Ordering

Order segments by:

1. `session.start_time` when available.
2. FIT message order as fallback.

Each segment gets a stable `segment_index` starting at 1.

### Segment Boundaries

For each session:

- `segment_start = session.start_time`.
- `segment_timer_end = segment_start + session.total_timer_time` when available.
- `segment_elapsed_end = segment_start + session.total_elapsed_time` when
  available.
- `segment_assignment_end`:
  - next session `start_time` when available;
  - otherwise `segment_elapsed_end`;
  - otherwise `segment_timer_end`;
  - otherwise the parent activity end.

Use half-open intervals `[start, end)` for assigning records and laps. This
prevents boundary samples from being double-counted.

Do not use `session.timestamp` as the end time unless validation shows it is
later than `start_time` and consistent with the session duration.

### Record Assignment

Assign each `record` to the first segment whose assignment interval contains the
record timestamp.

If a record cannot be assigned:

- Keep it attached to the parent activity.
- Leave `segment_id = NULL`.
- Count unassigned records in import metadata.

If a record falls into overlapping segment intervals:

- Prefer the segment with the latest start time.
- Record the overlap count in import metadata.

### Lap Assignment

Assign each lap to a segment by:

1. Lap `start_time` inside a segment assignment interval.
2. If lap `start_time` is missing, use FIT message order and lap sport/sub-sport.
3. If still ambiguous, leave `segment_id = NULL` and keep the lap visible only in
   the parent view.

As with sessions, do not assume `lap.timestamp` is a reliable end time. Prefer
`start_time + total_timer_time` or `start_time + total_elapsed_time`.

### Parent Metrics

The parent activity represents the whole multisport recording.

Parent duration priority:

1. FIT activity `total_timer_time`.
2. Sum of session `total_timer_time`.
3. Sum of session `total_elapsed_time`.
4. Existing record-span fallback.

Parent distance priority:

1. FIT activity total distance when available.
2. Sum of session distances.
3. Existing record distance fallback.

Parent start/end:

- Start: earliest segment start, or earliest record timestamp.
- End: latest segment assignment end, or latest record timestamp.

Parent naming:

- Use `Multisport` or a short composed label such as `Bike / Run / Bike`.
- Do not reverse-geocode the parent from a child GPS leg unless the UI clearly
  indicates that the location is only from a specific leg.

### Child Naming

Suggested generated names:

- `Bike 1`
- `T1`
- `Run`
- `T2`
- `Bike 2`

Rules:

- Use sport/sub-sport labels for sport legs.
- Use `T1`, `T2`, etc. for transitions.
- Number repeated sport legs.
- Keep raw FIT sport/sub-sport in metadata.

## API Design

Add segment-aware APIs while preserving existing single-activity endpoints.

Recommended additions:

- `GET /api/activities`
  - Include `activity_kind`.
  - Include lightweight child segment summaries for multisport parents, or
    provide a companion endpoint.
- `GET /api/activities/{activity_id}/segments`
  - Returns ordered child segments.
- `GET /api/activities/{activity_id}/records`
  - Existing parent behavior.
  - Add optional `segment_id` query parameter.
- `GET /api/activities/{activity_id}/laps`
  - Add or update endpoint to return first-class laps.
  - Add optional `segment_id` query parameter.

Do not expose child segments as unrelated top-level activity IDs unless the API
also marks them as children and prevents double-counting.

## UI Design

### Activity List

Show a multisport parent as an expandable row:

```text
v Multisport - 3h55m - 68.8 km
    Bike 1 - 1h55m - 40.3 km
    T1 - 4m52s
    Run - 52m45s - 8.1 km
    T2 - 2m50s
    Bike 2 - 59m56s - 20.2 km
```

Selection behavior:

- Clicking the parent opens the whole activity.
- Clicking a child opens the same activity detail page scoped to that segment.
- Child rows should be indented and visually subordinate.
- Transition rows should be available but visually de-emphasized.

### Detail Page

Add a compact segment selector near the activity title or existing summary area:

```text
Entire Activity | Bike 1 | T1 | Run | T2 | Bike 2
```

When a segment is selected:

- Summary stats use only that segment.
- Charts use only records assigned to that segment.
- Map uses only GPS records assigned to that segment.
- Laps table shows only laps assigned to that segment.
- Sport-specific calculations use the selected segment sport/sub-sport.

The parent view should show the whole recording, but it should clearly represent
mixed-sport data. Sport-specific calculations that require a single sport should
be unavailable or explicitly segment-scoped.

### Maps

For parent multisport view:

- Show all GPS records that exist.
- Do not imply indoor/no-GPS legs had GPS routes.
- Consider using subtle segment markers or segment colors once segment route
  rendering is available.

For child view:

- Show only the selected segment route.
- If the segment has no GPS, show the normal no-map state.

### Filters

Sport filters should account for child segments:

- Filtering by `running` should match a multisport parent containing a running
  leg.
- When the parent is expanded, only matching child rows should be emphasized.
- Child rows must not add to activity counts in overview totals.

Implementation can start with parent-level inclusion, then add richer child-row
filter display later.

### Overview Totals

Overview totals should count parent activities only.

Rules:

- A multisport parent contributes one activity count.
- Parent duration and distance contribute to totals.
- Child segments do not contribute separately to global totals.
- Segment-level totals may be shown only in segment-specific drilldowns.

## Compatibility and Migration

- Existing activities remain `activity_kind = single`.
- Existing records remain `segment_id = NULL`.
- Existing activity metadata remains valid.
- New segment/lap tables can be empty for existing imports.
- Previously imported multisport files should be re-imported to populate segment
  data unless a migration can reconstruct sessions from stored metadata.

## MVP Scope

Recommended first implementation:

1. Detect multisport FIT files.
2. Store parent activity plus `activity_segments`.
3. Assign records to segments.
4. Store laps in `activity_laps`.
5. Add API support for listing segments and querying records/laps by segment.
6. Add activity detail segment selector.
7. Prevent overview double-counting.

Activity-list expansion, richer sport filtering, and segment-colored map display
can follow if needed, but the data model should support them from the start.

## Tests

Parser tests:

- Detect `auto_multi_sport` activity type.
- Import multiple sessions in stable order.
- Assign records by session `start_time` and duration/boundaries.
- Do not use repeated or invalid `session.timestamp` as an end time.
- Assign laps by lap start time and session boundaries.
- Preserve transition sessions.
- Preserve indoor/no-GPS legs without borrowing GPS from another leg.

Database tests:

- Parent and child segment rows are stored correctly.
- Records receive expected `segment_id`.
- Existing single-sport imports still work.
- Overview totals count parent multisport activities once.

API/UI tests:

- Parent activity view returns all records/laps.
- Segment view returns only selected segment records/laps.
- Map state is correct for GPS and no-GPS segments.
- Sport-specific calculations are disabled for mixed parent view or scoped to a
  selected segment.

## Open Questions

- Which FIT activity types beyond `auto_multi_sport` should trigger multisport
  handling?
- Should parent names be always `Multisport`, or should they be composed from
  child sport labels?
- Should transition distance be included in parent distance exactly as reported
  by FIT sessions?
- Should child segments be searchable as separate rows in the activity list, or
  only visible when the parent is expanded?
- Should re-import automatically replace an old flattened multisport import, or
  should users delete and re-import affected files?
